import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type BlockedPage,
  CAMOUFOX_JS_VERSION,
  type Clock,
  GRID_MIN_SCROLL_SPACING_SECONDS,
  GRID_MOVE_BUDGET_MS,
  GRID_MOVE_RESERVE_MS,
  type Logger,
  systemClock,
} from '@gmt/core';
import { checkAccountCookies } from './accountCookies.js';
import { type PageBudget, pageBudget } from './budget.js';
import { classifyPageWithRule } from './classify.js';
import { loadWorkerConfig, type WorkerConfig } from './config.js';
import { CooldownStore } from './cooldown.js';
import {
  CheapestStepFailed,
  type ContextLike,
  createDriver,
  type Driver,
  LOOKUP_TIMEOUT_MS,
  type PageLike,
  POLL_TIMEOUT_MS,
  type ProbePage,
  pollUntilSettled,
  probePage,
  runStep,
  type Settled,
  type StepOptions,
} from './driver.js';
import { type GuardState, installGuard, installProbeGuard, onAllowlist } from './guard.js';
import { type LaunchOptions, launchContext, launchOptionsForMeta, prepareLaunch } from './launch.js';
import { acquireLock, LockHeld, sweepProbeProfiles } from './lock.js';
import { debugLogging, stderrLog } from './log.js';
import { MonthlyCounter } from './monthly.js';
import { Pacer } from './pacer.js';
import { profileDir } from './paths.js';
import type { View } from './ready.js';
import {
  type GridDirection,
  parseRecordArgs,
  RECORDED_BY,
  type RecordArgs,
  type RecordingKind,
  RecordingRefused,
} from './recordArgs.js';
import { type Outcome, recordGraph, recordGrid, type Seen } from './recordDialogs.js';
import {
  type StopFacts,
  stopRecord,
  stripQuery,
  tightenRecordings,
  writeExploration,
  writeRecording,
  writeStopRecord,
  writeUnrecorded,
} from './recordWrite.js';
import { Refusal } from './refusal.js';
import { type Entry, type EntryContext, EX_CONFIG, EX_SOFTWARE, EX_UNAVAILABLE } from './run.js';
import { SELECTORS, SELECTORS_VERSION, type Selectors } from './selectors.js';
import { loadSocs, type ReadBack, readBack, type SocsCapture, socsCookie } from './socs.js';
import { bounded, type Deadline, DeadlineExceeded, realTimers, type Timers } from './timers.js';
import { pageUrl, probeUrl } from './url.js';

export { stderrLog } from './log.js';
/**
 * The recorder (spec §2 "Recordings first"; brief Task 14.2; decision 69 round 2, item 4; PIE-R2-01, PIE-R2-12,
 * SEC-R2-003, SEC-015, TS-05, TS2-10, TS2-12). It loads Google pages in the worker's own browser and profile under every
 * rule the server applies (fix round 1, sec I2/I3, prov-int I2/I3/I4): the lock, the shared pacer, a standing signed-in
 * refusal refuses before any launch, the allowlist guard, SOCS set before every page, one page deadline over the load,
 * any click and every read, each re-poll after a click classified, SOCS read back by value after the whole interaction
 * (bounded), the cool-down on any block, the persisted refusal on either signed-in cause, and the profile wiped on a
 * consent stop or a SOCS that is not the captured one. It writes what the locators read to
 * `fixtures/recorded/<kind>/<date>/<n>.{facts,meta}.json` (gitignored, local-only, 0600: decision 61). It never stores
 * a cookie value, the worker key, an account name or an e-mail address, and stores printed ARIA text only in the Price
 * graph exploration and the date grid recording (`graph-explore/<date>/<n>.json` and `grid/<date>/<n>.json`, queries
 * stripped, never parsed; recordDialogs.ts). The consent probe is the one navigation exception, and it lives only here.
 */
export {
  KINDS,
  MAX_PAGES,
  parseRecordArgs,
  RECORDED_BY,
  type RecordArgs,
  type RecordingKind,
  RecordingRefused,
  STABILITY_PAGES,
} from './recordArgs.js';
export { assertClean, writeRecording } from './recordWrite.js';

export const DEFAULT_ROOT = fileURLToPath(new URL('../fixtures/recorded/', import.meta.url));
/** The bound on the read-back and the page close after a page (the session's own, brief §7 "Deadlines"). */
const FINALLY_MS = 5000;

export interface RecordDeps {
  clock: Clock;
  timers: Timers;
  log: Logger;
  /** Launches the worker's browser into `profile` (the persistent one, or a throwaway probe profile). */
  launch(profile: string): Promise<ContextLike>;
  launchOptions: Omit<LaunchOptions, 'env'>;
  binary: string;
  root: string;
  pollMs: number;
  selectors: Selectors;
  pid: number;
  isAlive?: (pid: number) => boolean;
}

export async function record(ctx: EntryContext, cfg: WorkerConfig, deps: RecordDeps): Promise<number> {
  let args: RecordArgs;
  try {
    args = parseRecordArgs(ctx.args);
  } catch (e) {
    ctx.err(e instanceof Error ? e.message : String(e));
    return EX_CONFIG;
  }
  let lock: { release(): void };
  try {
    lock = acquireLock(ctx.dataDir, {
      pid: deps.pid,
      ...(deps.isAlive === undefined ? {} : { isAlive: deps.isAlive }),
    });
  } catch (e) {
    ctx.err(e instanceof LockHeld ? `${e.message}: stop the worker before recording` : String(e));
    return EX_CONFIG;
  }
  try {
    sweepProbeProfiles(ctx.dataDir);
    tightenRecordings(deps.root);
    const cooldown = new CooldownStore({
      dir: ctx.dataDir,
      challengeHours: cfg.cooldownHours,
      clock: deps.clock,
    });
    const refusal = new Refusal({ dir: ctx.dataDir, clock: deps.clock });
    // why: fix round 1 (sec I2): the server's first stop, before anything opens: a standing refusal is cleared only by
    // clear-signed-in, which wipes the profile first
    if (refusal.active() !== null) {
      ctx.err('a signed-in refusal stands; run clear-signed-in before recording');
      return EX_UNAVAILABLE;
    }
    const active = cooldown.active();
    if (active !== null) {
      ctx.err(`cooling down until ${active.until} (${active.cause}); no page is loaded before then`);
      return EX_UNAVAILABLE;
    }
    const pacer = new Pacer({
      dir: ctx.dataDir,
      minSpacingSeconds: cfg.minSpacingSeconds,
      clock: deps.clock,
    });
    // why: decision 82: every page the recorder loads counts in the worker's own month, as the server's do
    const monthly = new MonthlyCounter({
      dir: ctx.dataDir,
      caps: { pages: cfg.monthlyPageCap, scrolls: cfg.monthlyScrollCap, billingDay: cfg.billingDay },
      clock: deps.clock,
    });
    const day = deps.clock.now().slice(0, 10);
    if (args.kind === 'consent-probe')
      return await consentProbe(ctx, cfg, deps, { pacer, monthly, cooldown, day });
    let capture: SocsCapture;
    try {
      capture = loadSocs(ctx.dataDir, deps.clock);
    } catch (e) {
      ctx.err(e instanceof Error ? e.message : String(e));
      return EX_CONFIG;
    }
    const secrets = [cfg.key.reveal(), capture.value];
    const profile = profileDir(ctx.dataDir);
    let context: ContextLike | null = await deps.launch(profile);
    const readBacks: ReadBack[] = [];
    try {
      for (let i = 0; i < args.pages; i++) {
        const req = args.request;
        if (req === null) throw new RecordingRefused('no request');
        await claim(pacer, monthly, args.moves.length, deps, ctx);
        const c: ContextLike = context ?? (await deps.launch(profile));
        context = c;
        // why: ruling of 2026-10-18: the first view has the page timeout; the Cheapest flow the same again from its click,
        // within twice that from the start (budget.next in interact); `budget.d` is the current deadline
        const pageStart = deps.timers.now();
        const pageMs = cfg.pageTimeoutSeconds * 1000;
        // why: WP15 ruling 10: a grid page's overall cap is the first view's budget plus, per move, the spacing and the
        // move's own budget
        const budget = pageBudget(
          deps.timers,
          pageMs,
          pageStart,
          2 * pageMs +
            args.moves.length *
              (GRID_MIN_SCROLL_SPACING_SECONDS * 1000 + GRID_MOVE_BUDGET_MS + GRID_MOVE_RESERVE_MS),
        );
        const d = budget.d;
        let outcome: Outcome | null = null;
        let failure: unknown = null;
        let page: PageLike | null = null;
        let guard: GuardState | null = null;
        try {
          // why: TS2-10: the only cookie the recorder sets is socsCookie(capture).
          await d.race(c.addCookies([socsCookie(capture)]));
          const account = await d.race(checkAccountCookies(c, deps.clock));
          if (account.found) {
            ctx.err(`the profile holds Google account cookies (${account.names.join(', ')})`);
            outcome = {
              kind: 'stop',
              page: 'signed-in',
              rule: 'account-cookie',
              landing: '',
              hops: [],
              stepMs: {},
              facts: null,
              clicked: [],
              headings: [],
            };
          } else {
            const p = await d.race(c.newPage());
            page = p;
            // why: --no-flights reads what appeared once the deadline passes, so its page stays open until then
            if (args.kind !== 'no-flights') budget.onExpire(() => void p.close().catch(() => undefined));
            guard = await d.race(installGuard(c, p, deps.log, deps.selectors));
            const driver = createDriver(p, guard, deps.selectors);
            outcome = await interact(
              driver,
              p,
              guard,
              budget,
              pageStart,
              deps,
              args.kind,
              pageUrl({ ...req, gl: cfg.pointOfSale }),
              args.moves,
            );
          }
        } catch (e) {
          failure = e;
        } finally {
          budget.d.clear();
        }
        // Rule 5, as the server: after the whole interaction, the read-back by value, then the page closed, bounded.
        let back: ReadBack | 'overran' = 'missing';
        if (page !== null || outcome?.kind === 'stop') {
          const r = await bounded(() => c.cookies(), FINALLY_MS, deps.timers);
          back = r.overran ? 'overran' : readBack(r.value, capture);
        }
        if (page !== null) {
          const p = page;
          await bounded(() => p.close(), FINALLY_MS, deps.timers);
        }
        pacer.release();
        if (back !== 'overran') readBacks.push(back);
        if (failure !== null && !(outcome?.kind === 'stop')) {
          if (failure instanceof DeadlineExceeded)
            throw new RecordingRefused(
              `the page did not settle within CAMOUFOX_PAGE_TIMEOUT_SECONDS (${cfg.pageTimeoutSeconds})`,
            );
          throw failure;
        }
        if (outcome === null) throw new RecordingRefused('no outcome');
        // why: rule 1 for every kind (no --no-flights exemption, prov-int I3): the landing and every hop the guard saw,
        // up to now (a late hop included, sec M4), on the allowlist
        const landing = page?.url() ?? '';
        const late = guard === null ? [] : [...guard.hops];
        const offList = page !== null && [landing, ...late].some((u) => !onAllowlist(u, deps.selectors));
        // why: fix round 2 (N1): an overrun read-back says nothing about the cookie, so it never makes a stop on its
        // own (the page is refused below), and it never unmakes one: a stop keeps its cool-down, refusal and wipe
        const overran = back === 'overran';
        const stopKind: BlockedPage | null =
          outcome.kind === 'stop'
            ? outcome.page
            : offList
              ? 'off-allowlist'
              : !overran && back !== 'same'
                ? 'consent-unhandled'
                : null;
        if (stopKind === null && overran) {
          // why: as the server: an overrun discards the context, and nothing from the page is written
          await bounded(() => c.close(), FINALLY_MS, deps.timers);
          context = null;
          throw new RecordingRefused('the SOCS read-back overran; nothing written');
        }
        if (stopKind !== null) {
          // why: diagnostics of 2026-10-18: every stop writes what the classifier saw and logs the decision
          const rule =
            outcome.kind === 'stop'
              ? outcome.rule
              : offList
                ? 'off-allowlist-late-hop'
                : `socs-read-back:${back}`;
          const seen: Seen =
            outcome.kind === 'appeared'
              ? { facts: null, clicked: [], headings: [] }
              : { facts: outcome.facts, clicked: outcome.clicked, headings: outcome.headings };
          deps.log.debug(
            { cause: stopKind, rule, elapsedMs: deps.timers.now() - pageStart },
            'classifier decision',
          );
          const changed = !overran && back !== 'same';
          const merged = changed && stopKind !== 'consent-unhandled';
          const hours = merged
            ? Math.max(cooldown.hoursFor(stopKind), cooldown.hoursFor('consent-unhandled'))
            : cooldown.hoursFor(stopKind);
          const until = cooldown.start(stopKind, hours).until;
          if (stopKind === 'signed-in')
            refusal.set('a signed-in account control or account cookie (recorder)');
          // why: the final review of 2026-10-18: the stop record is a diagnostic only, written after the cool-down and
          // the refusal; a write the fail-closed scan refuses (an account address in a heading) is a warning, never a
          // reason to skip either
          try {
            writeStopRecord(
              deps.root,
              day,
              stopRecord({
                cause: stopKind,
                rule,
                kind: args.kind,
                landing: outcome.kind === 'stop' ? outcome.landing : landing,
                hops: outcome.kind === 'stop' ? outcome.hops : late,
                socsReadBack: back,
                recordedAt: deps.clock.now(),
                facts: seen.facts,
                clicked: seen.clicked,
                headings: seen.headings,
              }),
              secrets,
            );
          } catch (e) {
            deps.log.warn(
              { cause: stopKind, reason: e instanceof Error ? e.name : 'unknown' },
              'stop record not written',
            );
          }
          // why: ruling 9 / session rule 5: a consent stop or a SOCS that is not the captured one leaves Google's
          // consent state in the shared profile; it is wiped before the server's next page
          if (stopKind === 'consent-unhandled' || changed || overran) {
            await bounded(() => c.close(), FINALLY_MS, deps.timers);
            context = null;
            if (stopKind === 'consent-unhandled' || changed)
              rmSync(profile, { recursive: true, force: true });
          }
          if (stopKind === 'consent-unhandled')
            writeRecording(
              deps.root,
              args.kind,
              day,
              {
                facts: {
                  failure: stopKind,
                  landing: stripQuery(outcome.kind === 'stop' ? outcome.landing : landing),
                  hops: (outcome.kind === 'stop' ? outcome.hops : late).map(stripQuery),
                  socsReadBack: back,
                },
                meta: meta(deps, args.kind, back, outcome.stepMs, { failure: stopKind }),
              },
              secrets,
            );
          ctx.err(`stopped: ${stopKind}; cooling down until ${until}; the work stops for an operator ruling`);
          return EX_UNAVAILABLE;
        }
        if (outcome.kind === 'stop') throw new RecordingRefused('unreachable');
        if ((args.kind === 'graph-explore' || args.kind === 'grid') && outcome.kind === 'read') {
          const path = writeExploration(
            deps.root,
            args.kind,
            day,
            {
              recordedAt: deps.clock.now(),
              recordedBy: RECORDED_BY,
              ...outcome.data,
              // why: ruling 7: the fixed window the grid's layout was read at
              window: deps.launchOptions.window,
              socsReadBack: back,
              versions: {
                selectors: SELECTORS_VERSION,
                camoufoxJs: CAMOUFOX_JS_VERSION,
                binary: deps.binary,
              },
              timings: outcome.stepMs,
            },
            secrets,
          );
          ctx.out(`recorded ${path}`);
          continue;
        }
        if (outcome.kind === 'appeared' || (args.kind === 'no-flights' && !outcome.noFlights)) {
          writeUnrecorded(deps.root, day, { data: outcome.data }, secrets);
          ctx.out(
            'no recognisable "no flights" line appeared; wrote no-flights/unrecorded.meta.json, NO_FLIGHTS_VERIFIED stays false',
          );
          continue;
        }
        const path = writeRecording(
          deps.root,
          args.kind,
          day,
          {
            facts: { ...outcome.data, socsReadBack: back },
            meta: meta(deps, args.kind, back, outcome.stepMs, {}),
          },
          secrets,
        );
        ctx.out(`recorded ${path}`);
      }
    } finally {
      const c = context;
      if (c !== null) await bounded(() => c.close(), FINALLY_MS, deps.timers);
    }
    if (args.kind === 'socs-stability' && !readBacks.every((b) => b === 'same')) {
      ctx.err(
        `SOCS read-backs ${readBacks.join(', ')}: SOCS_STABLE stays false; an operator ruling is needed`,
      );
      return EX_UNAVAILABLE;
    }
    return 0;
  } catch (e) {
    ctx.err(e instanceof Error ? e.message : String(e));
    return e instanceof RecordingRefused ? EX_CONFIG : EX_SOFTWARE;
  } finally {
    lock.release();
  }
}

/**
 * The month's caps, then the shared pacer: a page past the monthly page cap (or with fewer scrolls left than its
 * moves, or an unreadable counts file) is refused before anything loads; the spacing is waited out once (fake timers
 * in tests); then the page and its scrolls are reserved in the counts, which are never settled down (an over-count).
 */
async function claim(
  pacer: Pacer,
  monthly: MonthlyCounter,
  scrolls: number,
  deps: RecordDeps,
  ctx: EntryContext,
): Promise<void> {
  const admitted = monthly.check(scrolls);
  if (admitted.kind !== 'ok' || admitted.scrollAllowance < scrolls)
    throw new RecordingRefused(
      `the worker's monthly caps leave no room for this page (until ${monthly.windowEnd()}), or monthly.json is unreadable`,
    );
  const first = pacer.claim();
  if (!first.ok) {
    ctx.out(`waiting ${first.retryAfterSeconds} s for the spacing`);
    await deps.timers.sleep(first.retryAfterSeconds * 1000);
    const second = pacer.claim();
    if (!second.ok) throw new RecordingRefused(`the spacing still refuses (${second.retryAfterSeconds} s)`);
  }
  monthly.write(admitted.reserved);
}

/** The recorder reads with the no-flights hypothesis on, so it can see the line it is recording. */
const reading = (S: Selectors): Selectors => ({ ...S, NO_FLIGHTS_VERIFIED: true });

/**
 * One page under one deadline: goto, the settle, for --cheapest and --view-more the click and its re-poll (classified:
 * any blocked kind, or a page that is not results, is a stop; prov-int I2), then every read.
 */
async function interact(
  driver: Driver,
  page: PageLike,
  guard: GuardState,
  budget: PageBudget,
  pageStart: number,
  deps: RecordDeps,
  kind: RecordingKind,
  url: string,
  moves: readonly GridDirection[],
): Promise<Outcome> {
  let d = budget.d;
  const poll = (S: Selectors, view: View) =>
    pollUntilSettled(driver, d, deps.timers, deps.pollMs, S, { view, log: deps.log, startedAt: pageStart });
  const stepMs: Record<string, number> = {};
  const t0 = deps.timers.now();
  const clicked: string[] = [];
  // why: diagnostics of 2026-10-18: a stop keeps the facts the classifier saw, the rule that fired, what was clicked and
  // the page's headings (read under their own short bound, never the page deadline, which may have passed)
  const stop = async (p: BlockedPage, rule: string, facts: StopFacts | null = null): Promise<Outcome> => {
    const h = deps.timers.deadline(FINALLY_MS);
    let headings: string[] = [];
    try {
      headings = await driver.headingNames(h);
    } catch {
      headings = [];
    } finally {
      h.clear();
    }
    return {
      kind: 'stop',
      page: p,
      rule,
      landing: page.url(),
      hops: [...guard.hops],
      stepMs,
      facts,
      clicked,
      headings,
    };
  };
  try {
    await driver.goto(url, d);
  } catch (e) {
    if (guard.refused === null) throw e;
    return await stop(guard.refused, `guard-refused:${guard.refused}`);
  }
  stepMs.goto = deps.timers.now() - t0;
  let settled: Settled;
  try {
    settled = await poll(reading(deps.selectors), 'best');
  } catch (e) {
    // why: rule 4 (prov-int I3): a --no-flights page that never settles is "what appeared", read once more
    if (!(e instanceof DeadlineExceeded) || kind !== 'no-flights') throw e;
    const after = deps.timers.deadline(FINALLY_MS * 2);
    try {
      const facts = await driver.readFacts(after);
      const k = classifyPageWithRule(facts.page, reading(deps.selectors));
      if (k.kind.kind === 'blocked' && k.kind.page !== 'unrecognised')
        return await stop(k.kind.page, k.rule, { page: facts.page, settle: facts.settle });
      return {
        kind: 'appeared',
        data: {
          kind,
          landing: page.url(),
          hops: [...guard.hops],
          page: facts.page,
          headings: await driver.headingNames(after),
        },
        stepMs: { ...stepMs, settle: deps.timers.now() - t0 },
      };
    } finally {
      after.clear();
    }
  }
  if (settled.kind.kind === 'blocked') return await stop(settled.kind.page, settled.rule, settled.facts);
  stepMs.settle = deps.timers.now() - t0;
  // why: a failed step may be a page that is no results page at all (a challenge after the click): it is classified
  // once, under its own step, and a blocked kind is that stop, with its cool-down; otherwise null (end plainly)
  const classifyAfterFailedStep = async (
    cur: Deadline,
    steps: StepOptions,
    view: View,
  ): Promise<Outcome | null> => {
    const lookups = { timers: deps.timers, lookupMs: LOOKUP_TIMEOUT_MS };
    const seen = await runStep('classify-after-failed-step', POLL_TIMEOUT_MS, cur, steps, (st) =>
      driver.readFacts(st, lookups),
    ).catch((err: unknown) => {
      if (err instanceof DeadlineExceeded || cur.expired()) throw err;
      return null;
    });
    if (seen === null) return null;
    const k = classifyPageWithRule(seen.page, deps.selectors, view);
    if (k.kind.kind === 'blocked' && k.kind.page !== 'unrecognised')
      return await stop(k.kind.page, k.rule, { page: seen.page, settle: seen.settle });
    return null;
  };
  if (kind === 'grid' || kind === 'graph-explore') {
    // why: no-flights and results are the only kinds left after the blocked stop above
    const shown = settled.kind.kind === 'results' ? 'results' : 'no-flights';
    const c = {
      driver,
      page,
      guard,
      budget,
      d,
      pageStart,
      t0,
      deps,
      stepMs,
      clicked,
      stop,
      classifyAfterFailedStep,
    };
    return kind === 'grid' ? await recordGrid(c, shown, moves) : await recordGraph(c, shown);
  }
  // why: rule 5: only --cheapest and --view-more click these controls before their flags are set.
  if (kind === 'cheapest' || kind === 'view-more') {
    if (kind === 'cheapest' && settled.facts.page.cheapestTabs.length === 1) {
      // why: ruling of 2026-10-18: the tab's own information pop-up closed through its exact button, then the tab
      d = budget.next();
      const steps = { timers: deps.timers, log: deps.log, startedAt: pageStart };
      try {
        clicked.push(...(await driver.clickCheapest(d, steps)));
        // why: rulings of 2026-10-18: every Cheapest poll is a 20 s step with 5 s lookups; an overrun is polled again
        settled = await poll(deps.selectors, 'cheapest');
      } catch (e) {
        if (e instanceof DeadlineExceeded) throw e;
        const blocked = await classifyAfterFailedStep(d, steps, 'cheapest');
        if (blocked !== null) return blocked;
        // why: otherwise the step ends the recording plainly, naming it; no cool-down (nothing stopped the page)
        const step = e instanceof CheapestStepFailed ? `${e.step} (${e.reason})` : 'click';
        // why: the budget's end is the view not settling, said as such; any other step is the click flow
        throw new RecordingRefused(
          e instanceof CheapestStepFailed && e.step === 'cheapest-poll'
            ? `the Cheapest view did not settle within its budget (${step}); the debug log has the poll lines`
            : `the Cheapest tab could not be clicked: the ${step} step; the debug log has the step lines`,
        );
      }
    } else if (kind === 'view-more') {
      await driver.click('button', deps.selectors.results.viewMoreButton, d);
      clicked.push(`button:${deps.selectors.results.viewMoreButton}`);
    }
    if (clicked.length > 0) {
      // why: the Cheapest view was polled inside its try above; View more settles here
      if (kind !== 'cheapest') settled = await poll(deps.selectors, 'best');
      if (settled.kind.kind !== 'results')
        return await stop(
          settled.kind.kind === 'blocked' ? settled.kind.page : 'unrecognised',
          settled.kind.kind === 'blocked' ? settled.rule : `${settled.kind.kind}-after-click`,
          settled.facts,
        );
    }
  }
  const data = {
    kind,
    landing: page.url(),
    hops: [...guard.hops],
    page: settled.facts.page,
    settle: settled.facts.settle,
    clicked,
    names: await driver.resultNames(d),
    list: await driver.listFacts(d),
    form: await driver.formFacts(d),
    headings: await driver.headingNames(d),
  };
  stepMs.read = deps.timers.now() - t0;
  return {
    kind: 'read',
    data,
    noFlights: settled.facts.page.text.noFlights,
    stepMs,
    facts: settled.facts,
    clicked,
    headings: data.headings,
  };
}

function meta(
  deps: RecordDeps,
  kind: RecordingKind,
  back: ReadBack | 'overran',
  stepMs: Record<string, number>,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    recordedAt: deps.clock.now(),
    recordedBy: RECORDED_BY,
    kind,
    socsReadBack: back,
    launchOptions: deps.launchOptions,
    versions: { selectors: SELECTORS_VERSION, camoufoxJs: CAMOUFOX_JS_VERSION, binary: deps.binary },
    stepMs,
    ...extra,
  };
}

/**
 * Rule 3: the consent probe. A throwaway profile `<data>/probe-<time>-<pid>` (deleted in a `finally`, a thrown error
 * included), no SOCS, the probe guard, a page typed without `click`. It records the consent page's facts and starts no
 * cool-down for that expected page; any other blocked kind cools down as usual.
 */
async function consentProbe(
  ctx: EntryContext,
  cfg: WorkerConfig,
  deps: RecordDeps,
  s: { pacer: Pacer; monthly: MonthlyCounter; cooldown: CooldownStore; day: string },
): Promise<number> {
  const profile = join(ctx.dataDir, `probe-${Date.parse(deps.clock.now())}-${deps.pid}`);
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  try {
    await claim(s.pacer, s.monthly, 0, deps, ctx);
    const context = await deps.launch(profile);
    const d = deps.timers.deadline(cfg.pageTimeoutSeconds * 1000);
    try {
      const page = await d.race(context.newPage());
      d.onExpire(() => void page.close().catch(() => undefined));
      const guard = await d.race(installProbeGuard(context, page, deps.log, deps.selectors));
      const probe: ProbePage = probePage(createDriver(page, guard, deps.selectors));
      const t0 = deps.timers.now();
      let blocked: BlockedPage | null = null;
      try {
        await probe.goto(probeUrl(cfg.pointOfSale), d);
      } catch (e) {
        if (guard.refused === null) throw e;
        blocked = guard.refused;
      }
      let settled: Settled | null = null;
      if (blocked === null) {
        settled = await pollUntilSettled(probe, d, deps.timers, deps.pollMs, reading(deps.selectors), {
          log: deps.log,
          startedAt: t0,
        });
        if (settled.kind.kind === 'blocked' && settled.kind.page !== 'consent-unhandled')
          blocked = settled.kind.page;
      }
      if (blocked !== null) {
        const until = s.cooldown.start(blocked).until;
        ctx.err(`the probe stopped on ${blocked}; cooling down until ${until}`);
        return EX_UNAVAILABLE;
      }
      const data = {
        kind: 'consent-probe',
        landing: page.url(),
        hops: [...guard.hops],
        page: settled?.facts.page ?? null,
        settle: settled?.facts.settle ?? null,
        clicked: [],
        names: await probe.resultNames(d),
        list: await probe.listFacts(d),
        form: await probe.formFacts(d),
        headings: await probe.headingNames(d),
      };
      const path = writeRecording(
        deps.root,
        'consent-probe',
        s.day,
        {
          facts: data,
          meta: meta(
            deps,
            'consent-probe',
            'missing',
            { settle: deps.timers.now() - t0 },
            { profile: 'throwaway' },
          ),
        },
        [cfg.key.reveal()],
      );
      ctx.out(`recorded ${path}`);
      return 0;
    } catch (e) {
      if (e instanceof DeadlineExceeded)
        throw new RecordingRefused(
          `the page did not settle within CAMOUFOX_PAGE_TIMEOUT_SECONDS (${cfg.pageTimeoutSeconds})`,
        );
      throw e;
    } finally {
      d.clear();
      s.pacer.release();
      await bounded(() => context.close(), FINALLY_MS, deps.timers);
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

/** The real dependencies: the system clock, real timers, and the browser launched with the prepared options. */
export function realRecordDeps(
  prepared: ReturnType<typeof prepareLaunch>,
  err: (line: string) => void,
  debug = false,
): RecordDeps {
  return {
    clock: systemClock,
    timers: realTimers,
    log: stderrLog(err, debug),
    launch: (profile) => launchContext(prepared.options, profile),
    launchOptions: launchOptionsForMeta(prepared.options),
    binary: prepared.install.build,
    root: DEFAULT_ROOT,
    pollMs: 2000,
    selectors: SELECTORS,
    pid: process.pid,
  };
}

/** The command: settings from worker.env, the real browser and clock. */
export const entry: Entry = async (ctx) => {
  const cfg = loadWorkerConfig(ctx.env);
  const prepared = prepareLaunch({
    platform: process.platform,
    arch: process.arch,
    installDirSet: ctx.env.CAMOUFOX_INSTALL_DIR,
    dataDir: ctx.dataDir,
    home: cfg.home,
    path: cfg.path,
    tmp: cfg.tmp,
  });
  return record(ctx, cfg, realRecordDeps(prepared, ctx.err, debugLogging(ctx.env)));
};

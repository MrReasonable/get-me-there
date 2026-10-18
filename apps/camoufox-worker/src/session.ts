import { rmSync } from 'node:fs';
import {
  type BlockedPage,
  type Clock,
  type IsoDateTime,
  type Logger,
  type PageRequest,
  stripUrlsInText,
  type Versions,
  type WorkerAnswer,
} from '@gmt/core';
import { checkAccountCookies } from './accountCookies.js';
import { type PageBudget, pageBudget } from './budget.js';
import { classifyPageWithRule } from './classify.js';
import type { CooldownStore } from './cooldown.js';
import {
  type ContextLike,
  createDriver,
  type Driver,
  LOOKUP_TIMEOUT_MS,
  type PageLike,
  POLL_TIMEOUT_MS,
  pollUntilSettled,
  runStep,
  type Settled,
} from './driver.js';
import { checkForm } from './form.js';
import { installGuard } from './guard.js';
import { readList } from './list.js';
import type { Pacer } from './pacer.js';
import type { Refusal } from './refusal.js';
import { SELECTORS, type Selectors } from './selectors.js';
import { readBack, type SocsCapture, socsCookie } from './socs.js';
import { bounded, DeadlineExceeded, type Timers } from './timers.js';
import { pageUrl } from './url.js';

/**
 * One Google page per call (spec §2; brief Task 14.4; decision 69 rulings 5, 6 and 9; TS-09, TS-10, TS2-14). The order
 * is fixed: grid is refused; a standing refusal or cool-down answers without opening anything; the pacer claims a start
 * or answers `spacing`; then, inside a `try` whose `finally` releases the pacer first and unconditionally: SOCS is set,
 * the account cookies are checked, the page opens and is polled until settled (blocked kinds on every poll), the search
 * form is checked, verified controls only are clicked, and the list is read. On every path after `goto`, SOCS is read
 * back by value under its own bound, then the page is closed under its own bound. Every thrown error maps to one
 * answer; `googleContacted` is true once `goto` was called.
 */
export interface PageResult {
  answer: WorkerAnswer;
  googleContacted: boolean;
  /** The cool-down store could not be read: main answers, then exits 70 for the operator to look. */
  fatal?: true;
}

export interface SessionDeps {
  /** Launches (or relaunches, after a wipe) the persistent context. */
  launch(): Promise<ContextLike>;
  profileDir: string;
  socs: SocsCapture;
  cooldown: CooldownStore;
  pacer: Pacer;
  refusal: Refusal;
  clock: Clock;
  timers: Timers;
  selectors?: Selectors;
  pageTimeoutMs: number;
  finallyTimeoutMs?: number;
  pollMs?: number;
  log: Logger;
  versions: Versions;
  /** Test seam: builds the driver over a page (createDriver by default). */
  driverFor?: typeof createDriver;
}

type Stage = 'launch' | 'navigate' | 'read';

function detailOf(e: unknown): string {
  return stripUrlsInText(e instanceof Error ? e.message : String(e)).slice(0, 200);
}

export class PageSession {
  private context: ContextLike | null = null;
  // why: fix round 1 (prov-int M7): memoised on the promise, so a status call and a page call arriving together
  // launch one persistent context on the profile, never two
  private launching: Promise<ContextLike> | null = null;
  private readonly S: Selectors;
  private readonly finallyMs: number;
  private readonly pollMs: number;
  private busySince: IsoDateTime | null = null;

  constructor(private readonly d: SessionDeps) {
    this.S = d.selectors ?? SELECTORS;
    this.finallyMs = d.finallyTimeoutMs ?? 5000;
    this.pollMs = d.pollMs ?? 2000;
  }

  /** The start of the page in flight, for `/v1/status`. */
  busy(): IsoDateTime | null {
    return this.busySince;
  }

  /** The context, launched on first use and after a wipe; one launch in flight at a time. */
  currentContext(): Promise<ContextLike> {
    if (this.context !== null) return Promise.resolve(this.context);
    if (this.launching === null) {
      const p = this.d.launch();
      this.launching = p;
      p.then(
        (c) => {
          // why: a launch that outlived a discard (its caller's deadline passed) is closed, never kept
          if (this.launching === p) this.context = c;
          else void c.close().catch(() => undefined);
        },
        () => undefined,
      ).finally(() => {
        if (this.launching === p) this.launching = null;
      });
    }
    return this.launching;
  }

  /** Closes the context (bounded) and forgets it; with `wipe`, removes the profile so the next page starts clean. */
  async discard(wipe: boolean): Promise<void> {
    const c = this.context;
    this.context = null;
    this.launching = null;
    if (c !== null) await bounded(() => c.close(), this.finallyMs, this.d.timers);
    if (wipe) rmSync(this.d.profileDir, { recursive: true, force: true });
  }

  async page(req: PageRequest): Promise<PageResult> {
    if (req.mode === 'grid')
      return { answer: { kind: 'mode-unavailable', mode: 'grid' }, googleContacted: false };
    let active: ReturnType<CooldownStore['active']>;
    let refusal: ReturnType<Refusal['active']>;
    try {
      active = this.d.cooldown.active();
      refusal = this.d.refusal.active();
    } catch (e) {
      return {
        answer: {
          kind: 'browser-error',
          stage: 'read',
          detail: `cool-down store unreadable: ${detailOf(e)}`,
        },
        googleContacted: false,
        fatal: true,
      };
    }
    if (refusal !== null)
      return {
        answer: {
          kind: 'cooling-down',
          cause: 'signed-in',
          cooldownUntil: active?.until ?? this.d.clock.now(),
        },
        googleContacted: false,
      };
    if (active !== null)
      return {
        answer: { kind: 'cooling-down', cause: active.cause, cooldownUntil: active.until },
        googleContacted: false,
      };
    const claim = this.d.pacer.claim();
    if (!claim.ok)
      return {
        answer: { kind: 'spacing', retryAfterSeconds: claim.retryAfterSeconds },
        googleContacted: false,
      };

    this.busySince = this.d.clock.now();
    const started = this.d.timers.now();
    // why: ruling of 2026-10-18: the first view has CAMOUFOX_PAGE_TIMEOUT_SECONDS; the Cheapest flow gets the same again
    // from its click (budget.next), never past twice that from the start. `budget.d` is whichever deadline is current.
    const budget = pageBudget(this.d.timers, this.d.pageTimeoutMs, started);
    const deadline = budget.d;
    let stage: Stage = 'launch';
    let contacted = false;
    let page: PageLike | null = null;
    let context: ContextLike | null = null;
    let answer: WorkerAnswer;
    let stop: BlockedPage | null = null;
    let wipe = false;
    let merged = false;
    // why: fix round 1 (prov-int I1): every call before goto races the page deadline (rule 9), so a stalled browser
    // answers not-ready instead of holding the pacer for good; a failure here discards the context
    let preGotoFailed = false;
    try {
      const c = await deadline.race(this.currentContext());
      context = c;
      // why: TS2-10: the only cookie the worker ever sets.
      await deadline.race(c.addCookies([socsCookie(this.d.socs)]));
      const account = await deadline.race(checkAccountCookies(c, this.d.clock));
      if (account.found) {
        stop = 'signed-in';
        answer = this.blockedPlaceholder('signed-in');
      } else {
        const p = await deadline.race(c.newPage());
        page = p;
        budget.onExpire(() => {
          void p.close().catch(() => undefined);
        });
        const guard = await deadline.race(installGuard(c, p, this.d.log, this.S));
        const driver = (this.d.driverFor ?? createDriver)(p, guard, this.S);
        stage = 'navigate';
        contacted = true;
        let refused: BlockedPage | null = null;
        try {
          await driver.goto(pageUrl(req), deadline);
        } catch (e) {
          if (guard.refused === null) throw e;
          refused = guard.refused;
        }
        stage = 'read';
        if (refused !== null) {
          stop = refused;
          answer = this.blockedPlaceholder(refused);
        } else {
          const r = await this.read(driver, req, budget, started);
          answer = r.answer;
          stop = r.stop;
        }
      }
    } catch (e) {
      preGotoFailed = !contacted;
      answer =
        e instanceof DeadlineExceeded || budget.d.expired()
          ? { kind: 'not-ready', elapsedMs: Math.max(0, this.d.timers.now() - started) }
          : { kind: 'browser-error', stage, detail: detailOf(e) };
    } finally {
      this.d.pacer.release();
    }
    budget.d.clear();

    // Rule 5: after goto, on every path, the SOCS read-back by value, then the page closed, each under its own bound.
    let discard = preGotoFailed;
    if (contacted && context !== null) {
      const c = context;
      const back = await bounded(() => c.cookies(), this.finallyMs, this.d.timers);
      if (back.overran) {
        discard = true;
        if (answer.kind === 'cells')
          answer = { kind: 'browser-error', stage: 'read', detail: 'SOCS read-back overran' };
      } else if (readBack(back.value, this.d.socs) !== 'same') {
        wipe = true;
        // why: ruling 9: a block keeps its own kind; anything else becomes consent-unhandled.
        if (stop === null) {
          stop = 'consent-unhandled';
          answer = this.blockedPlaceholder('consent-unhandled');
        } else merged = true;
      }
    }
    if (page !== null) {
      const p = page;
      const closed = await bounded(() => p.close(), this.finallyMs, this.d.timers);
      if (closed.overran) {
        discard = true;
        if (answer.kind === 'cells')
          answer = { kind: 'browser-error', stage: 'read', detail: 'page close overran' };
      }
    }
    if (stop === 'consent-unhandled') wipe = true;
    if (wipe || discard) await this.discard(wipe);
    this.busySince = null;

    if (stop !== null) {
      try {
        // why: one page met two causes: the longer period, the earlier cause (Task 14.4 rule 5).
        const hours = merged
          ? Math.max(this.d.cooldown.hoursFor(stop), this.d.cooldown.hoursFor('consent-unhandled'))
          : this.d.cooldown.hoursFor(stop);
        const rec = this.d.cooldown.start(stop, hours);
        if (stop === 'signed-in') this.d.refusal.set('a signed-in account control or account cookie');
        answer = { kind: 'blocked', page: stop, cooldownUntil: rec.until };
      } catch (e) {
        return {
          answer: {
            kind: 'browser-error',
            stage: 'read',
            detail: `cool-down store unwritable: ${detailOf(e)}`,
          },
          googleContacted: contacted,
          fatal: true,
        };
      }
    }
    return { answer, googleContacted: contacted };
  }

  /** A blocked answer whose end the stop handling fills in; it never leaves the session as it is. */
  private blockedPlaceholder(page: BlockedPage): WorkerAnswer {
    return { kind: 'blocked', page, cooldownUntil: this.d.clock.now() };
  }

  private async read(
    driver: Driver,
    req: PageRequest,
    budget: PageBudget,
    started: number,
  ): Promise<{ answer: WorkerAnswer; stop: BlockedPage | null }> {
    const S = this.S;
    let d = budget.d;
    const poll = (view: 'best' | 'cheapest') =>
      pollUntilSettled(driver, d, this.d.timers, this.pollMs, S, {
        view,
        log: this.d.log,
        startedAt: started,
      });
    let settled: Settled = await poll('best');
    let fellBack = false;
    if (settled.kind.kind === 'blocked')
      return { answer: this.blockedPlaceholder(settled.kind.page), stop: settled.kind.page };
    if (settled.kind.kind === 'no-flights')
      return { answer: this.cells({ status: 'no-flights' }, 'unknown'), stop: null };
    const form = checkForm(await driver.formFacts(d), req);
    if (form !== 'ok') return { answer: this.blockedPlaceholder('unrecognised'), stop: 'unrecognised' };
    // why: the worker clicks only flows its selectors module marks verified (PIE-09), re-reading the facts after each.
    const after = async (view: 'best' | 'cheapest'): Promise<WorkerAnswer | null> => {
      settled = await poll(view);
      if (settled.kind.kind === 'results') return null;
      return this.blockedPlaceholder(settled.kind.kind === 'blocked' ? settled.kind.page : 'unrecognised');
    };
    if (S.CHEAPEST_FLOW_VERIFIED && settled.facts.page.cheapestTabs.length === 1) {
      d = budget.next();
      const steps = { timers: this.d.timers, log: this.d.log, startedAt: started };
      const lookups = { timers: this.d.timers, lookupMs: LOOKUP_TIMEOUT_MS };
      let cheapStop: WorkerAnswer | null = null;
      fellBack = false;
      try {
        await driver.clickCheapest(d, steps);
        // why: rulings of 2026-10-18: every Cheapest poll is a 20 s step with 5 s lookups inside it; one that overruns
        // is polled again, and only the budget's end fails the flow (then it falls back)
        cheapStop = await after('cheapest');
      } catch (e) {
        // why: the honesty rule (rulings of 2026-10-18): a Cheapest flow whose step fails or times out is read as the
        // Best view stands, and the tab's lower price goes with it, so the adapter marks the cell partial; the page
        // deadline still ends the page as not-ready
        if (e instanceof DeadlineExceeded || d.expired()) throw e;
        fellBack = true;
        // why: a failed step may be a page that is no results page at all (a challenge after the click): it is
        // classified once, under its own step, and a blocked kind stops the page with its cool-down, as on any poll
        const cur = d;
        const seen = await runStep('classify-after-failed-step', POLL_TIMEOUT_MS, cur, steps, (st) =>
          driver.readFacts(st, lookups),
        ).catch((err: unknown) => {
          if (err instanceof DeadlineExceeded || cur.expired()) throw err;
          return null;
        });
        if (seen !== null) {
          const k = classifyPageWithRule(seen.page, S, 'cheapest');
          if (k.kind.kind === 'blocked' && k.kind.page !== 'unrecognised')
            return { answer: this.blockedPlaceholder(k.kind.page), stop: k.kind.page };
        }
      }
      if (cheapStop !== null && cheapStop.kind === 'blocked')
        return { answer: cheapStop, stop: cheapStop.page };
    }
    if (S.VIEW_MORE_ADDS_CHEAPER) {
      await driver.click('button', S.results.viewMoreButton, d);
      const stop = await after(settled.facts.settle.cheapestSelected ? 'cheapest' : 'best');
      if (stop !== null && stop.kind === 'blocked') return { answer: stop, stop: stop.page };
    }
    const list = readList(await driver.listFacts(d), req);
    // why: ruling of 2026-10-18: a Cheapest view that never settled and left no list to read is a page that did not
    // settle (not-ready, no cool-down), never an unrecognised page
    if (fellBack && list.minMinor === null && list.optionsOtherCell === 0)
      return {
        answer: { kind: 'not-ready', elapsedMs: Math.max(0, this.d.timers.now() - started) },
        stop: null,
      };
    // why: decision 69: a page in another currency, or one with no option read for any cell, is not a page this app
    // reads; one whose options are all for another cell was read (fix round 1, prov I1): a cell issue, never a block
    if (list.currency !== 'GBP' || (list.minMinor === null && list.optionsOtherCell === 0))
      return { answer: this.blockedPlaceholder('unrecognised'), stop: 'unrecognised' };
    if (list.minMinor === null)
      return {
        answer: this.cells(
          {
            status: 'none-for-cell',
            optionsOtherCell: list.optionsOtherCell,
            optionsUnparsed: list.optionsUnparsed,
          },
          list.pointOfSale,
        ),
        stop: null,
      };
    return {
      answer: this.cells(
        {
          status: 'price',
          amountMinor: list.minMinor,
          tabMinor: list.tabMinor,
          optionsUnparsed: list.optionsUnparsed,
          optionsOtherCell: list.optionsOtherCell,
          returnDateFrom: 'query-and-form',
        },
        list.pointOfSale,
      ),
      stop: null,
    };
  }

  private cells(cell: Extract<WorkerAnswer, { kind: 'cells' }>['cell'], pointOfSale: string): WorkerAnswer {
    return {
      kind: 'cells',
      fetchedAt: this.d.clock.now(),
      currency: 'GBP',
      pointOfSale,
      cell,
      notes: [],
      versions: this.d.versions,
    };
  }
}

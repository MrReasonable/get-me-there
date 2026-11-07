import { rmSync } from 'node:fs';
import {
  asIsoDateTime,
  type BlockedPage,
  type Clock,
  FLIGHT_LIST_PAGES_PER_PAIR_MAX,
  type FlightsRequest,
  GRID_MOVE_BUDGET_MS,
  GRID_MOVE_RESERVE_MS,
  type IsoDateTime,
  type ListRequest,
  type Logger,
  type PageRequest,
  RETURN_PAGE_PERIODS,
  RETURN_SPACED_LOADS,
  stripUrlsInText,
  type Versions,
  type WorkerAnswer,
  workerRuleSchema,
} from '@gmt/core';
import { checkAccountCookies } from './accountCookies.js';
import { type PageBudget, pageBudget } from './budget.js';
import type { CooldownStore } from './cooldown.js';
import {
  type ContextLike,
  createDriver,
  type Driver,
  type PageLike,
  pollUntilSettled,
  type Settled,
} from './driver.js';
import { type FlightsRead, readFlights } from './flights.js';
import { readGrid } from './gridSession.js';
import { type GuardState, installGuard } from './guard.js';
import { logSkippedOptions, readList } from './list.js';
import type { Pacer } from './pacer.js';
import { POLL_MS } from './ready.js';
import type { Refusal } from './refusal.js';
import { returnPhase, unverifiedReturns } from './returnPhase.js';
import { SELECTORS, type Selectors } from './selectors.js';
import { servedSequence } from './served.js';
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
  /** The request asks for more than this worker allows (a grid page past its scroll cap): the server answers 400. */
  rejected?: true;
}

/** Grid mode's worker-side settings (spec §2 rev 34): off unless worker.env sets CAMOUFOX_MODE=grid. */
export interface GridSettings {
  mode: 'list' | 'grid';
  spacingMs: number;
  scrollCap: number;
  stepDays: { departures: number; returns: number };
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
  grid?: GridSettings;
  /**
   * Whether the worker's last grid page ended `first-not-drawn`, shared by every page session of the worker (pages at
   * once), so "a second such page in a row" is the worker's row, not one browser's; a session of its own by default.
   */
  gridRow?: { notDrawn: boolean };
}

type Stage = 'launch' | 'navigate' | 'read';

/** How a list or flights read ended: the answer, the stop and its rule, and a flights answer's outbound read. */
interface ReadEnd {
  answer: WorkerAnswer;
  stop: BlockedPage | null;
  rule?: string;
  /** A flights answer's outbound read (null: Google's no-flights line) and the view it stood on (the return phase's). */
  outbound?: { read: FlightsRead | null; view: 'cheapest' | 'best-fallback' | null };
}

/** A flights request that asks for the return phase (spec rev 56 §2: `returnLimits` present). */
type PhaseRequest = FlightsRequest & { returnLimits: NonNullable<FlightsRequest['returnLimits']> };
function asksForReturns(r: PageRequest | FlightsRequest): r is PhaseRequest {
  return r.mode === 'flights' && r.returnLimits !== undefined;
}

/**
 * The page's overall cap in ms (ruling of 2026-10-18; WP15 ruling 10; spec rev 56 §2, ruling D7): two page timeouts
 * (the first view and its Cheapest flow); a grid page has two more and the spacing (its one reload after a first view
 * that never drew a price: Ian's ruling of 2026-11-03) and, per move, the scroll spacing and the move's own budget; a
 * flights request with a return phase on a verified entry has RETURN_PAGE_PERIODS page periods (8 with a booking read:
 * 750,000 ms at the defaults; 6 without: 570,000) and one spacing (the reload's, RETURN_SPACED_LOADS).
 */
export function pageCapMs(
  req: PageRequest | FlightsRequest,
  S: Pick<Selectors, 'RETURN_SELECT_VERIFIED' | 'BOOKING_SELECT_VERIFIED'>,
  pageTimeoutMs: number,
  spacingMs: number,
  gridSpacingMs = 0,
): number {
  if (req.mode === 'grid')
    return (
      4 * pageTimeoutMs +
      spacingMs +
      req.moves.length * (gridSpacingMs + GRID_MOVE_BUDGET_MS + GRID_MOVE_RESERVE_MS)
    );
  if (asksForReturns(req) && S.RETURN_SELECT_VERIFIED) {
    const periods =
      RETURN_PAGE_PERIODS[req.booking === true && S.BOOKING_SELECT_VERIFIED ? 'booking' : 'returnsOnly'];
    return periods * pageTimeoutMs + RETURN_SPACED_LOADS * spacingMs;
  }
  return 2 * pageTimeoutMs;
}

/**
 * Spec rev 56 §2 (R-zero, R-spacing): every answer kind that may answer a return-phase request states the documents it
 * loaded and, once the reload started (its pacer start recorded), when the next load may start; the kinds that answer no such request (cells,
 * grid, mode-unavailable) are returned as they are.
 */
function withPageCounts(a: WorkerAnswer, pagesLoaded: number, next: IsoDateTime | null): WorkerAnswer {
  const counts = { pagesLoaded, ...(next === null ? {} : { nextLoadNotBefore: next }) };
  switch (a.kind) {
    case 'cells':
    case 'grid':
    case 'mode-unavailable':
      return a;
    case 'flights':
      return { ...a, ...counts };
    case 'blocked':
      return { ...a, ...counts };
    case 'cooling-down':
      return { ...a, ...counts };
    case 'spacing':
      return { ...a, ...counts };
    case 'not-ready':
      return { ...a, ...counts };
    case 'browser-error':
      return { ...a, ...counts };
    default: {
      const never: never = a;
      return never;
    }
  }
}

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
  /** The last grid page ended `first-not-drawn` (gridSession.ts: a second one in a row is refused). */
  private readonly gridRow: { notDrawn: boolean };
  /** timers.now() at which the page in flight reaches its overall cap (final review A-I1), null when none is. */
  private busyUntil: number | null = null;
  /** This session's page holds a pacer claim (from the claim until the `finally` that releases it). */
  private claimed = false;

  constructor(private readonly d: SessionDeps) {
    this.S = d.selectors ?? SELECTORS;
    this.finallyMs = d.finallyTimeoutMs ?? 5000;
    this.pollMs = d.pollMs ?? POLL_MS;
    this.gridRow = d.gridRow ?? { notDrawn: false };
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

  /**
   * One page: a list or grid page (`POST /v1/page`) or a flights page (`POST /v1/flights`, spec revision 55 §2 "The
   * flight-list read"). A flights page is a list page under every rule of one; only its reader and answer differ.
   */
  async page(asked: PageRequest | FlightsRequest): Promise<PageResult> {
    // why: spec rev 56 §2: a request carrying returnLimits on a verified entry states its page counts on every answer
    const phase = asksForReturns(asked) && this.S.RETURN_SELECT_VERIFIED;
    const counts = { loads: 0, reclaimed: false };
    const r = await this.run(asked, phase, counts);
    return this.counted(asked, phase, counts, r);
  }

  /**
   * Pages at once: the answer for a request that finds every page session busy, given by the one that can end soonest
   * (slots.ts picks it by `waitSeconds`): what `page` answers before it claims anything (grid refused, a refusal or a
   * cool-down), else `spacing` with this session's wait. It opens nothing and claims nothing.
   */
  async refuseBusy(asked: PageRequest | FlightsRequest): Promise<PageResult> {
    const phase = asksForReturns(asked) && this.S.RETURN_SELECT_VERIFIED;
    const r = this.gate(asked) ?? {
      answer: { kind: 'spacing', retryAfterSeconds: this.waitSeconds() },
      googleContacted: false,
    };
    return this.counted(asked, phase, { loads: 0, reclaimed: false }, r);
  }

  /** The wait a busy answer from this session states (`busyWait` over the pacer's own wait while it is full). */
  waitSeconds(): number {
    return this.busyWait(Math.max(1, Math.ceil(this.d.pacer.spacingMs / 1000)));
  }

  private counted(
    asked: PageRequest | FlightsRequest,
    phase: boolean,
    counts: { loads: number; reclaimed: boolean },
    r: PageResult,
  ): PageResult {
    if (!phase) return r;
    // why: review M5: the pacer's last start moves when the reload re-claims it, whether or not that document then
    // loaded (held, or its load failed), so the next start is stated from the re-claim, not only from a second load
    const next = counts.loads > 1 || counts.reclaimed ? this.nextLoad() : null;
    return { ...r, answer: withPageCounts(r.answer, counts.loads, next) };
  }

  /**
   * Final review A-I1: the wait a spacing answer states. While a page is in flight it is the rest of that page's overall
   * cap plus its bounded close (the SOCS read-back and the page's close, each `finallyMs`), never less than the pacer's
   * own wait, so the app's retry (http-kit waits the stated Retry-After) comes once the page can have ended instead of
   * spending its attempts while the browser is still busy; otherwise the pacer's wait as it stands.
   */
  private busyWait(pacerSeconds: number): number {
    // why: the page's close runs after its claim is released; a refusal then is the spacing's alone
    if (this.busyUntil === null || !this.claimed) return pacerSeconds;
    const left = this.busyUntil + 2 * this.finallyMs - this.d.timers.now();
    return Math.max(pacerSeconds, Math.ceil(left / 1000));
  }

  /** R-spacing: the last document load's start (the pacer's record) plus the spacing; null when it cannot be read. */
  private nextLoad(): IsoDateTime | null {
    try {
      const last = this.d.pacer.lastPageAt();
      return last === null
        ? null
        : asIsoDateTime(new Date(Date.parse(last) + this.d.pacer.spacingMs).toISOString());
    } catch {
      return null;
    }
  }

  /** What a request is answered before anything is claimed or opened, or null when it may go on to the pacer. */
  private gate(req: PageRequest | FlightsRequest): PageResult | null {
    // why: decision 70: grid pages only once the selectors module verifies the grid and worker.env asks for it
    if (req.mode === 'grid' && (!this.S.GRID_VERIFIED || this.d.grid?.mode !== 'grid'))
      return { answer: { kind: 'mode-unavailable', mode: 'grid' }, googleContacted: false };
    if (req.mode === 'grid' && req.moves.length > (this.d.grid?.scrollCap ?? 0))
      return {
        answer: { kind: 'mode-unavailable', mode: 'grid' },
        googleContacted: false,
        rejected: true,
      };
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
    return null;
  }

  private async run(
    req: PageRequest | FlightsRequest,
    phase: boolean,
    counts: { loads: number; reclaimed: boolean },
  ): Promise<PageResult> {
    const gated = this.gate(req);
    if (gated !== null) return gated;
    const claim = this.d.pacer.claim();
    if (!claim.ok)
      return {
        answer: { kind: 'spacing', retryAfterSeconds: this.busyWait(claim.retryAfterSeconds) },
        googleContacted: false,
      };
    this.claimed = true;

    this.busySince = this.d.clock.now();
    const started = this.d.timers.now();
    // why: ruling of 2026-10-18: the first view has CAMOUFOX_PAGE_TIMEOUT_SECONDS; the Cheapest flow gets the same again
    // from its click (budget.next), never past twice that from the start. `budget.d` is whichever deadline is current.
    // why: WP15 ruling 10: a grid page's overall cap adds, per move, the scroll spacing and the move's own budget
    // why: spec rev 56 §2 (ruling D7): a return-phase request's cap covers every page period of its served path
    const cap = pageCapMs(
      req,
      this.S,
      this.d.pageTimeoutMs,
      this.d.pacer.spacingMs,
      this.d.grid?.spacingMs ?? 0,
    );
    const budget = pageBudget(this.d.timers, this.d.pageTimeoutMs, started, cap);
    this.busyUntil = started + cap;
    const counter = { scrolls: 0 };
    const scrolls = (): { scrolls?: number } => (req.mode === 'grid' ? { scrolls: counter.scrolls } : {});
    const deadline = budget.d;
    let stage: Stage = 'launch';
    let contacted = false;
    let page: PageLike | null = null;
    let context: ContextLike | null = null;
    let answer: WorkerAnswer;
    let stop: BlockedPage | null = null;
    // why: the live grid run of 2026-10-18 on 8885ba8: every stop logs the rule that made it, as the recorder does
    let rule = 'unknown';
    let wipe = false;
    let merged = false;
    // why: fix round 1 (prov-int I1): every call before goto races the page deadline (rule 9), so a stalled browser
    // answers not-ready instead of holding the pacer for good; a failure here discards the context
    let preGotoFailed = false;
    let guardState: GuardState | null = null;
    try {
      const c = await deadline.race(this.currentContext());
      context = c;
      // why: TS2-10: the only cookie the worker ever sets.
      await deadline.race(c.addCookies([socsCookie(this.d.socs)]));
      const account = await deadline.race(checkAccountCookies(c, this.d.clock));
      if (account.found) {
        stop = 'signed-in';
        rule = 'account-cookie';
        answer = this.blockedPlaceholder('signed-in');
      } else {
        const p = await deadline.race(c.newPage());
        page = p;
        budget.onExpire(() => {
          void p.close().catch(() => undefined);
        });
        const guard = await deadline.race(installGuard(c, p, this.d.log, this.S));
        guardState = guard;
        // why: cost-r3-002 (D8: return-phase requests only): the documents never pass the request's own worst case,
        // FLIGHT_LIST_PAGES_PER_PAIR_MAX, which the app's ledger planned for it
        if (phase) guard.reservation = FLIGHT_LIST_PAGES_PER_PAIR_MAX;
        const driver = (this.d.driverFor ?? createDriver)(p, guard, this.S);
        stage = 'navigate';
        contacted = true;
        let refused: BlockedPage | null = null;
        const url = pageUrl(
          req.mode === 'grid'
            ? {
                origin: req.origin,
                destination: req.destination,
                departureDate: req.start.departureDate,
                returnDate: req.start.returnDate,
                gl: req.gl,
              }
            : req,
        );
        try {
          await driver.goto(url, deadline);
        } catch (e) {
          if (guard.refused === null) throw e;
          refused = guard.refused;
        }
        stage = 'read';
        if (refused !== null) {
          stop = refused;
          rule = `guard-refused:${refused}`;
          answer = this.blockedPlaceholder(refused);
        } else {
          let ob: ReadEnd['outbound'];
          const r =
            req.mode === 'grid'
              ? await readGrid(
                  {
                    driver,
                    page: p,
                    req,
                    budget,
                    started,
                    counter,
                    S: this.S,
                    pollMs: this.pollMs,
                    notDrawnBefore: this.gridRow.notDrawn,
                    reload: { url, guard, pacer: this.d.pacer, pageTimeoutMs: this.d.pageTimeoutMs },
                  },
                  this.d,
                ).then((x) => {
                  this.gridRow.notDrawn = x.answer.kind === 'grid' && x.answer.ended === 'first-not-drawn';
                  return x;
                })
              : await this.read(driver, req, budget, started).then((x) => {
                  ob = x.outbound;
                  // why: CodeRabbit on PR #39: a list or flights page read between two grid pages breaks the row
                  this.gridRow.notDrawn = false;
                  return x;
                });
          answer = r.answer;
          stop = r.stop;
          rule = r.rule ?? 'read';
          // why: spec rev 56 §2: the return phase, after the outbound read of a request carrying returnLimits
          if (asksForReturns(req) && stop === null && answer.kind === 'flights' && ob !== undefined) {
            const a = answer;
            if (!phase) answer = { ...a, returns: unverifiedReturns(req, ob.read) };
            else {
              const ph = await returnPhase({
                driver,
                guard,
                budget,
                // why: review M5: the re-claim is recorded once it wrote the pacer's start (a refused wait records nothing)
                pacer: {
                  spacingMs: this.d.pacer.spacingMs,
                  reclaim: async (d, t) => {
                    await this.d.pacer.reclaim(d, t);
                    counts.reclaimed = true;
                  },
                },
                url: pageUrl(req),
                req,
                outbound: ob.read,
                view: ob.view,
                S: this.S,
                timers: this.d.timers,
                log: this.d.log,
                pollMs: this.pollMs,
                startedAt: started,
                pageTimeoutMs: this.d.pageTimeoutMs,
              });
              if ('stop' in ph) {
                stop = ph.stop;
                rule = ph.rule;
                answer = this.blockedPlaceholder(ph.stop);
              } else
                answer = {
                  ...a,
                  flights: ph.flights,
                  returns: ph.returns,
                  // why: the answer is as of the phase's end
                  fetchedAt: this.d.clock.now(),
                  versions:
                    ph.offerGrammar === null ? a.versions : { ...a.versions, offerGrammar: ph.offerGrammar },
                };
            }
          }
        }
      }
    } catch (e) {
      preGotoFailed = !contacted;
      answer =
        e instanceof DeadlineExceeded || budget.d.expired()
          ? { kind: 'not-ready', elapsedMs: Math.max(0, this.d.timers.now() - started), ...scrolls() }
          : { kind: 'browser-error', stage, detail: detailOf(e), ...scrolls() };
    } finally {
      this.claimed = false;
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
        if (answer.kind === 'cells' || answer.kind === 'grid' || answer.kind === 'flights')
          answer = { kind: 'browser-error', stage: 'read', detail: 'SOCS read-back overran', ...scrolls() };
      } else if (readBack(back.value, this.d.socs) !== 'same') {
        wipe = true;
        // why: ruling 9: a block keeps its own kind; anything else becomes consent-unhandled.
        if (stop === null) {
          stop = 'consent-unhandled';
          rule = 'socs-read-back';
          answer = this.blockedPlaceholder('consent-unhandled');
        } else merged = true;
      }
    }
    if (page !== null) {
      const p = page;
      const closed = await bounded(() => p.close(), this.finallyMs, this.d.timers);
      if (closed.overran) {
        discard = true;
        if (answer.kind === 'cells' || answer.kind === 'grid' || answer.kind === 'flights')
          answer = { kind: 'browser-error', stage: 'read', detail: 'page close overran', ...scrolls() };
      }
    }
    if (stop === 'consent-unhandled') wipe = true;
    if (wipe || discard) await this.discard(wipe);
    this.busySince = null;
    this.busyUntil = null;
    counts.loads = guardState?.documentLoads ?? 0;

    if (stop !== null) {
      this.d.log.debug(
        { cause: stop, rule, elapsedMs: Math.max(0, this.d.timers.now() - started) },
        'classifier decision',
      );
      try {
        // why: one page met two causes: the longer period, the earlier cause (Task 14.4 rule 5).
        const hours = merged
          ? Math.max(this.d.cooldown.hoursFor(stop), this.d.cooldown.hoursFor('consent-unhandled'))
          : this.d.cooldown.hoursFor(stop);
        const rec = this.d.cooldown.start(stop, hours);
        if (stop === 'signed-in') this.d.refusal.set('a signed-in account control or account cookie');
        // why: the grid runs of 2026-10-26 stopped as unrecognised with nothing to say why: the rule goes on the answer
        // for the app's last_error, only as the bounded token the protocol accepts (never free text)
        const named = workerRuleSchema.safeParse(rule);
        answer = {
          kind: 'blocked',
          page: stop,
          cooldownUntil: rec.until,
          ...scrolls(),
          ...(named.success ? { rule: named.data } : {}),
        };
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
    req: ListRequest | FlightsRequest,
    budget: PageBudget,
    started: number,
  ): Promise<ReadEnd> {
    const S = this.S;
    // why: WP21 Task 21.3: the served sequence is one module (served.ts), run alike by this first view, the return
    // phase's reload and the recorder; its Cheapest flow takes `budget.next` here (ruling of 2026-10-18: the same page
    // timeout again from the click, never past twice that from the start)
    const served = await servedSequence(
      {
        driver,
        S,
        timers: this.d.timers,
        log: this.d.log,
        pollMs: this.pollMs,
        startedAt: started,
        request: req,
      },
      budget.d,
      () => budget.next(),
    );
    if (served.kind === 'stop')
      return { answer: this.blockedPlaceholder(served.page), stop: served.page, rule: served.rule };
    // why: ruling B8: Google's own no-flights line is answered here, before any reader runs; on a flights page it is
    // a flights answer, listed 'no-flights', with no flight and nothing else read
    if (served.kind === 'no-flights')
      return req.mode === 'flights'
        ? { answer: this.noFlightsAnswer(), stop: null, outbound: { read: null, view: null } }
        : { answer: this.cells({ status: 'no-flights' }, 'unknown'), stop: null };
    const d = served.d;
    let settled: Settled = served.shown;
    // why: spec rev 55 §2: a flights answer names the view it read: the Cheapest view, the Best view after the
    // Cheapest flow failed, or (null) the Best view where no Cheapest flow ran
    const view = served.view;
    const fellBack = view === 'best-fallback';
    // why: the worker clicks only flows its selectors module marks verified (PIE-09), re-reading the facts after each.
    const after = async (
      v: 'best' | 'cheapest',
    ): Promise<{ answer: WorkerAnswer; stop: BlockedPage; rule: string } | null> => {
      settled = await pollUntilSettled(driver, d, this.d.timers, this.pollMs, S, {
        view: v,
        log: this.d.log,
        startedAt: started,
      });
      if (settled.kind.kind === 'results') return null;
      const page = settled.kind.kind === 'blocked' ? settled.kind.page : 'unrecognised';
      // why: a no-flights page after a click names that, as the recorder does (`no-flights-after-click`)
      const rule = settled.kind.kind === 'blocked' ? settled.rule : `${settled.kind.kind}-after-click`;
      return { answer: this.blockedPlaceholder(page), stop: page, rule };
    };
    if (S.VIEW_MORE_ADDS_CHEAPER) {
      await driver.click('button', S.results.viewMoreButton, d);
      const stop = await after(settled.facts.settle.cheapestSelected ? 'cheapest' : 'best');
      if (stop !== null) return stop;
    }
    // why: spec rev 55 §2: the one branch a flights page makes, at the reader; every check below is the list page's
    const facts = await driver.listFacts(d);
    const flights = req.mode === 'flights' ? readFlights(facts, req) : null;
    const list = flights ?? readList(facts, req);
    logSkippedOptions(this.d.log, facts, req, flights?.rejected ?? []);
    // why: ruling of 2026-10-18: a Cheapest view that never settled and left no list to read is a page that did not
    // settle (not-ready, no cool-down), never an unrecognised page
    if (fellBack && list.minMinor === null && list.optionsOtherCell === 0)
      return {
        answer: { kind: 'not-ready', elapsedMs: Math.max(0, this.d.timers.now() - started) },
        stop: null,
      };
    // why: decision 69: a page in another currency, or one with no option read for any cell, is not a page this app
    // reads; one whose options are all for another cell was read (fix round 1, prov I1): a cell issue, never a block
    if (list.currency !== 'GBP')
      return { answer: this.blockedPlaceholder('unrecognised'), stop: 'unrecognised', rule: 'currency' };
    if (list.minMinor === null && list.optionsOtherCell === 0)
      return {
        answer: this.blockedPlaceholder('unrecognised'),
        stop: 'unrecognised',
        rule: 'no-options-read',
      };
    if (flights !== null)
      return {
        answer: this.flights(
          {
            listed: flights.listed,
            flights: flights.flights,
            minMinor: flights.minMinor,
            tabMinor: flights.tabMinor,
            optionsUnparsed: flights.optionsUnparsed,
            optionsOtherCell: flights.optionsOtherCell,
            resultsStated: flights.resultsStated,
            pointOfSale: flights.pointOfSale,
          },
          view,
        ),
        stop: null,
        outbound: { read: flights, view },
      };
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

  /**
   * Ruling B8: a flights page that showed Google's own no-flights line: listed 'no-flights', no flight, nothing else
   * read (no minimum, tab price, counts or view), the point of sale unknown as the list page's no-flights answer says.
   */
  private noFlightsAnswer(): WorkerAnswer {
    return this.flights(
      {
        listed: 'no-flights',
        flights: [],
        minMinor: null,
        tabMinor: null,
        optionsUnparsed: 0,
        optionsOtherCell: 0,
        resultsStated: null,
        pointOfSale: 'unknown',
      },
      null,
    );
  }

  /** A flights answer (spec rev 55 §2) from what the page listed and the view read. */
  private flights(
    read: Pick<
      Extract<WorkerAnswer, { kind: 'flights' }>,
      | 'listed'
      | 'flights'
      | 'minMinor'
      | 'tabMinor'
      | 'optionsUnparsed'
      | 'optionsOtherCell'
      | 'resultsStated'
      | 'pointOfSale'
    >,
    cheapestView: 'cheapest' | 'best-fallback' | null,
  ): WorkerAnswer {
    return {
      kind: 'flights',
      fetchedAt: this.d.clock.now(),
      currency: 'GBP',
      ...read,
      cheapestView,
      notes: [],
      versions: this.d.versions,
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

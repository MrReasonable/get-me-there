import type { FlightsRequest, IsoDateTime, PageRequest } from '@gmt/core';
import type { PageResult, PageSession } from './session.js';

/**
 * CAMOUFOX_PAGES_AT_ONCE (spec §2 "Limits"): the worker's page sessions, one for each page it may load at once, each
 * over its own browser and profile, so a page's guard, its SOCS set and read-back and its close stay its own. They
 * share the one pacer (its capacity the same number, its spacing start to start across all of them), the cool-down,
 * the refusal and the SOCS capture, so a block seen by any page stops every later one while pages already in flight
 * finish. A request goes to the first idle session; when none is idle the session that can end soonest answers it as
 * a busy session answers (`refuseBusy`), so the app's retry waits that long.
 */
export class PageSlots {
  private readonly inFlight = new Set<Promise<PageResult>>();

  constructor(private readonly sessions: readonly PageSession[]) {
    if (sessions.length === 0) throw new Error('the worker needs at least one page session');
  }

  /**
   * The first session: the start's and the status's account-cookie check read its context, launched at the start; the
   * others launch on their first page, and every page checks its own context's account cookies before it loads.
   */
  get first(): PageSession {
    const [s] = this.sessions;
    if (s === undefined) throw new Error('the worker needs at least one page session');
    return s;
  }

  page(req: PageRequest | FlightsRequest): Promise<PageResult> {
    // why: a session is busy from its pacer claim, made before `page` first awaits, so two requests arriving together
    // never pick the same idle session
    const idle = this.sessions.find((s) => s.busy() === null);
    const p = idle === undefined ? this.soonest().refuseBusy(req) : idle.page(req);
    this.inFlight.add(p);
    const done = (): void => {
      this.inFlight.delete(p);
    };
    p.then(done, done);
    return p;
  }

  /** The start of the earliest page in flight (`/v1/status`'s `busySince`), null when every session is idle. */
  busySince(): IsoDateTime | null {
    let earliest: IsoDateTime | null = null;
    for (const s of this.sessions) {
      const at = s.busy();
      if (at !== null && (earliest === null || Date.parse(at) < Date.parse(earliest))) earliest = at;
    }
    return earliest;
  }

  /** Resolves once every page in flight has answered (stop waits for them; a page's failure is its answer's). */
  async settled(): Promise<void> {
    await Promise.allSettled([...this.inFlight]);
  }

  /** Closes every session's browser (bounded, each), keeping the profiles. */
  async discardAll(): Promise<void> {
    await Promise.all(this.sessions.map((s) => s.discard(false)));
  }

  private soonest(): PageSession {
    let best = this.first;
    let wait = best.waitSeconds();
    for (const s of this.sessions) {
      const w = s.waitSeconds();
      if (w < wait) {
        best = s;
        wait = w;
      }
    }
    return best;
  }
}

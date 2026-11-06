// Spec revision 55 §8.1 "Stop causes" and "Automatic resume and the unscheduled search" (WP20 final review, Important):
// a paused_budget run's operator notice (email, Status) offers what its stop's fix on the search's page offers. A
// browser page limit, per run or monthly, says Search again carries on; an unscheduled search's window cap says it has no
// schedule and offers Search again or Resume; a run's own cap offers the cap change Edit makes; a scheduled run that
// stored a resume says when. The notice never offers a Resume the page refuses, never leaves out one it offers, and never
// says "definition".
import {
  asIsoDateTime,
  BUDGET_SCOPE_KINDS,
  BudgetExceeded,
  type BudgetScopeKind,
  type ProviderId,
  stopText,
} from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { finalStatus } from '../src/execute.js';
import type { StopReason } from '../src/run.js';
import { causeRun } from './support/causeRun.js';

const NOW = asIsoDateTime('2026-10-14T09:00:00.000Z');
const RESETS = asIsoDateTime('2026-11-01T00:00:00.000Z');
const TZ = 'Europe/London';

/** A budget stop at `scope` naming `providerId`, with a window end (`resumeAfter`) or none. */
function stopAt(scope: BudgetScopeKind, providerId: ProviderId | null, windowEnd: boolean): StopReason {
  return {
    kind: 'budget',
    error: new BudgetExceeded({
      scope,
      cap: 40,
      current: 40,
      requested: 1,
      ...(providerId === null ? {} : { providerId }),
    }),
    resumeAfter: windowEnd ? RESETS : null,
    resetsAt: windowEnd ? RESETS : null,
  };
}

/** The notice's detail and the page's fix for the same stop, as finish words both. */
function both(stop: StopReason, scheduled: boolean) {
  const r = finalStatus(stop, NOW, TZ, causeRun(), scheduled);
  const cause = r.patch.stopCause;
  if (cause === undefined || cause === null) throw new Error('a budget stop stores a cause');
  return {
    status: r.status,
    detail: r.notice?.detail ?? '',
    fix: stopText(cause, { tz: TZ, mode: 'container', scheduled }).fix,
  };
}

describe('the paused_budget notice offers what the page offers (revision 55 §8.1)', () => {
  it.each([true, false])(
    'a browser page limit per run says Search again carries on, never Resume (scheduled: %s)',
    (scheduled) => {
      const { detail, fix } = both(stopAt('provider-execution', 'camoufox', false), scheduled);
      expect(detail).toMatch(/Search again carries on with the prices already found\.$/);
      expect(detail).not.toMatch(/\bresume\b/i);
      expect(fix?.resume).toBeUndefined();
    },
  );

  it("an unscheduled search's window cap has no schedule: Search again, or Resume when you are ready", () => {
    for (const [scope, providerId] of [
      ['provider-month', 'searchapi'],
      ['global-month', null],
    ] as const) {
      const { detail, fix } = both(stopAt(scope, providerId, true), false);
      expect(detail).toMatch(/This search has no schedule; Search again, or Resume when you are ready\.$/);
      expect(fix?.resume).toBe(true);
    }
  });

  it('a scheduled run that stored a resume says when it resumes, and the page offers nothing', () => {
    const { detail, fix } = both(stopAt('provider-month', 'searchapi', true), true);
    expect(detail).toContain('It resumes automatically on Sun, 1 Nov 2026, 00:00 (Europe/London)');
    expect(fix).toBeNull();
  });

  it("a run's own cap is a cap change in Edit, then Resume, scheduled or not", () => {
    for (const scope of ['execution-calls', 'execution-free-calls', 'execution-cost'] as const)
      for (const scheduled of [true, false]) {
        const { detail, fix } = both(stopAt(scope, null, false), scheduled);
        expect(detail).toMatch(/Raise the limit in Edit, then Resume\.$/);
        expect(fix?.resume).toBe(true);
      }
  });

  it("a plan's lifetime calls used up says Check Providers, never Resume", () => {
    const { detail, fix } = both(stopAt('provider-lifetime', 'searchapi', false), true);
    expect(detail).toMatch(/Check Providers\.$/);
    expect(detail).not.toMatch(/\bresume\b/i);
    expect(fix?.resume).toBeUndefined();
  });

  it('over every scope, source, schedule and window end: the notice and the page agree on Resume, and no notice says definition', () => {
    const sources: Array<ProviderId | null> = ['camoufox', 'searchapi', 'travelpayouts', null];
    let cases = 0;
    for (const scope of BUDGET_SCOPE_KINDS)
      for (const providerId of sources) {
        // why: spec rev 64: the browser worker has no monthly cap, so no run stops at its month any more
        if (scope === 'provider-month' && providerId === 'camoufox') continue;
        for (const scheduled of [true, false])
          for (const windowEnd of [true, false]) {
            const { status, detail, fix } = both(stopAt(scope, providerId, windowEnd), scheduled);
            expect(status).toBe('paused_budget');
            // why: "Resume" with a capital is the operator's button; "resumes automatically" is the app's own resume
            expect({ scope, providerId, scheduled, windowEnd, offers: /\bResume\b/.test(detail) }).toEqual({
              scope,
              providerId,
              scheduled,
              windowEnd,
              offers: fix?.resume === true,
            });
            expect(detail).not.toMatch(/definition/i);
            expect(detail).not.toMatch(/cap change|manual resume/);
            cases += 1;
          }
      }
    expect(cases).toBe(BUDGET_SCOPE_KINDS.length * 16 - 4);
  });
});

describe("every other stop's notice names a resume only where the page offers Resume (revision 55 §8.1)", () => {
  const OTHERS: StopReason[] = [
    { kind: 'sigterm' },
    { kind: 'cancel', cause: { kind: 'cancelled' } },
    { kind: 'limiter-timeout', providerId: 'travelpayouts', resumeAfter: RESETS },
    { kind: 'limiter-timeout', providerId: 'travelpayouts', resumeAfter: null },
    { kind: 'all-disabled', stage: 'discovery' },
    { kind: 'all-disabled', stage: 'verification' },
    { kind: 'fatal', message: 'SQLITE_FULL' },
  ];
  it.each(OTHERS.flatMap((stop) => [true, false].map((scheduled) => [stop.kind, scheduled, stop] as const)))(
    '%s (scheduled: %s)',
    (_kind, scheduled, stop) => {
      // why: an all-disabled stop names the disabled sources of its stage; give it one, as a real pass would
      const run = causeRun({
        disabled: new Set<ProviderId>(['travelpayouts']),
        snapshot: {
          providers: {
            discovery: ['travelpayouts'],
            verification: ['travelpayouts'],
            discoveryRefreshHours: {},
          },
        },
      });
      const r = finalStatus(stop, NOW, TZ, run, scheduled);
      const cause = r.patch.stopCause;
      const detail = r.notice?.detail ?? '';
      const offersResume =
        cause !== undefined &&
        cause !== null &&
        stopText(cause, { tz: TZ, mode: 'container', scheduled }).fix?.resume === true;
      // why: "resumes automatically" is the app's own resume, not an offer; any other "resume" asks the operator to
      if (/\bresume\b/i.test(detail.replace(/resumes automatically/g, ''))) expect(offersResume).toBe(true);
      expect(detail).not.toMatch(/definition/i);
    },
  );
});

// The worker, consent and price-source cards on the review's findings (V5, V2, V8): what the worker will actually do, the
// real cause of "cannot check", the older worker's upper bound, and the cap rule.
import { asIsoDateTime, BLOCKED_PAGES, consentFixText, START_REFUSAL_REASONS } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildChecks, consentOutcome } from '../../src/read/status.js';
import type { StatusFacts, WorkerFacts } from '../../src/read/statusFacts.js';
import {
  ago,
  DAY,
  HOUR,
  healthyFacts,
  healthyWorker,
  inFuture,
  NOW,
  okWorkerStatus,
} from '../helpers/statusFacts.js';

const withStatus = (over: Parameters<typeof okWorkerStatus>[0] = {}, w: Partial<WorkerFacts> = {}) =>
  healthyFacts({ worker: healthyWorker({ read: { kind: 'ok', status: okWorkerStatus(over) }, ...w }) });
const checkOf = (f: StatusFacts, id: string) => {
  const c = buildChecks(f).find((x) => x.id === id);
  if (c === undefined) throw new Error(`no check ${id}`);
  return c;
};

describe('a worker that refuses pages is fail, whatever the reason (pa-b1-001)', () => {
  it.each([
    ['signed-in', { kind: 'signed-in' } as const, 'refusing pages: signed-in profile refused'],
    [
      'settings',
      { kind: 'settings', names: ['CAMOUFOX_MODE'] } as const,
      'refusing pages: settings differ between the app and the worker: CAMOUFOX_MODE',
    ],
    [
      'grid step',
      { kind: 'grid-unverified' } as const,
      'refusing pages: grid mode not verified on the worker',
    ],
    [
      'a grid setting',
      { kind: 'grid-setting', name: 'CAMOUFOX_GRID_SCROLL_CAP', worker: 10, app: 30 } as const,
      'refusing pages: CAMOUFOX_GRID_SCROLL_CAP differs between the app and the worker',
    ],
  ])('%s', (_n, finding, summary) => {
    const c = checkOf(withStatus({ finding }), 'worker');
    expect(c.state).toBe('fail');
    expect(c.summary).toContain(summary);
    expect(c.summary).not.toMatch(/\b(10|30)\b/);
    expect(c.fix).not.toBeNull();
  });

  it('and the browser provider is then not a usable price source', () => {
    const f = withStatus({ finding: { kind: 'signed-in' } }, {});
    expect(checkOf({ ...f, priceSources: { usable: [] } }, 'price-sources').state).toBe('warn');
  });

  it('a cool-down shows the providers’ plain words, never the raw page kind', () => {
    for (const cause of BLOCKED_PAGES) {
      const c = checkOf(withStatus({ finding: { kind: 'cooling', until: inFuture(DAY), cause } }), 'worker');
      expect(c.state).toBe('warn');
      expect(c.summary).not.toContain(`(${cause})`);
      expect(c.summary).toMatch(/cooling down until .* \(Europe\/London\) \(.+\)/);
    }
    expect(
      checkOf(withStatus({ finding: { kind: 'cooling', until: inFuture(DAY), cause: null } }), 'worker')
        .summary,
    ).not.toContain('(Google');
  });

  it('the monthly caps use the one capWarn: 79% is fine, 80% warns, a cap of 0 never warns (ca-b1-005)', () => {
    const monthly = (pages: number, scrolls: number) => ({ monthly: { pages, scrolls, readable: true } });
    expect(checkOf(withStatus(monthly(1199, 4799)), 'worker').state).toBe('ok');
    expect(checkOf(withStatus(monthly(1200, 0)), 'worker').state).toBe('warn');
    expect(checkOf(withStatus(monthly(0, 4800)), 'worker').state).toBe('warn');
    const zero = withStatus(monthly(0, 0), { caps: { pages: 0, scrolls: 6000 } });
    expect(checkOf(zero, 'worker').state).toBe('ok');
  });
});

describe('"cannot check" names its real reason (pa-b1-009)', () => {
  const consent = (w: Partial<WorkerFacts>) => checkOf(healthyFacts({ worker: healthyWorker(w) }), 'consent');
  it('not answering, key refused, unreadable answer, a worker that will not start', () => {
    expect(consent({ read: { kind: 'unreachable' } })).toMatchObject({
      state: 'warn',
      summary: 'cannot check: the worker is not answering',
      fix: { command: 'pnpm gmt start' },
    });
    expect(consent({ read: { kind: 'keys-differ' } })).toMatchObject({
      summary: "cannot check: the worker refused this app's key",
      fix: { command: 'pnpm gmt setup --reconfigure browser' },
    });
    expect(consent({ read: { kind: 'unreadable' } })).toMatchObject({
      summary: "cannot check: the worker's answer could not be read by this version",
      fix: { command: 'pnpm gmt update' },
    });
    const locked = consent({
      read: { kind: 'unreachable' },
      refusal: { kind: 'refusal', reason: 'locked', at: ago(HOUR) },
    });
    expect(locked.summary).toContain('cannot check: the worker will not start');
    expect(locked.fix?.command).toBe('pnpm gmt restart');
  });
  it('every refusal reason is judged, none leaves the card unexplained', () => {
    for (const reason of START_REFUSAL_REASONS) {
      const c = consent({
        read: { kind: 'unreachable' },
        refusal: { kind: 'refusal', reason, at: ago(HOUR) },
      });
      expect(c.summary.length).toBeGreaterThan(0);
    }
  });
});

describe('the cause behind the consent card (V2)', () => {
  const frame = { now: NOW, tz: 'Europe/London', mode: 'native' } as const;
  const cause = (w: Partial<WorkerFacts>) => consentOutcome(frame, healthyWorker(w)).cause;
  it('names expiring, expired, missing, not-rejection and cannot-check', () => {
    const soon = okWorkerStatus({
      consent: { kind: 'socs', expiresAt: inFuture(10 * DAY), boundedBy: 'cookie', mark: 'reject' },
    });
    const gone = okWorkerStatus({
      consent: { kind: 'socs', expiresAt: ago(DAY), boundedBy: 'cookie', mark: 'reject' },
    });
    const accepted = okWorkerStatus({
      consent: { kind: 'socs', expiresAt: inFuture(100 * DAY), boundedBy: 'cookie', mark: 'accept' },
    });
    const none = okWorkerStatus({ consent: null, socsCapturedAt: null });
    expect(cause({ read: { kind: 'ok', status: soon } })).toBe('expiring');
    expect(cause({ read: { kind: 'ok', status: gone } })).toBe('expired');
    expect(cause({ read: { kind: 'ok', status: accepted } })).toBe('not-rejection');
    expect(cause({ read: { kind: 'ok', status: none } })).toBe('missing');
    expect(cause({ read: { kind: 'ok', status: okWorkerStatus() } })).toBe('none');
    expect(cause({ read: { kind: 'unreachable' } })).toBe('cannot-check');
    // why: review X5: an older voided or never-shown record is one this version does not use, so it reads as missing
    for (const [reason, want] of [
      ['consent-missing', 'missing'],
      ['consent-expired', 'expired'],
      ['consent-voided', 'missing'],
      ['consent-not-shown', 'missing'],
      ['consent-not-rejection', 'not-rejection'],
    ] as const)
      expect(
        cause({ read: { kind: 'unreachable' }, refusal: { kind: 'refusal', reason, at: ago(HOUR) } }),
      ).toBe(want);
    expect(cause({ read: { kind: 'disabled' } })).toBe('none');
  });
  it('the fix is the one command that exists, with no pnpm gmt consent (po-b1-003)', () => {
    const c = consentOutcome(
      frame,
      healthyWorker({
        read: { kind: 'ok', status: okWorkerStatus({ consent: null, socsCapturedAt: null }) },
      }),
    ).check;
    expect(c.fix).toEqual({ text: consentFixText(), command: null });
    expect(JSON.stringify(buildChecks(healthyFacts()))).not.toContain('pnpm gmt consent');
  });
});

// why: review X1: a worker that does not report its record's mark (one before this version) is never labelled rejected;
// its capture bound is stated as the latest expiry, and once that has passed the record has expired whatever its mark
describe('a worker that does not report the mark (pa-b1-010, ca-b1-004, review X1)', () => {
  const older = (capturedAt: string, now = NOW) =>
    consentOutcome(
      { now, tz: 'Europe/London', mode: 'native' },
      healthyWorker({
        read: {
          kind: 'ok',
          status: okWorkerStatus({ consent: null, socsCapturedAt: asIsoDateTime(capturedAt) }),
        },
      }),
    );
  it('states the capture bound as the latest expiry, with the worker’s month-end clamp, and cannot be checked', () => {
    const c = older('2026-01-31T10:00:00.000Z', asIsoDateTime('2026-10-01T00:00:00.000Z'));
    expect(c.check.summary).toBe(
      'cannot check: this worker does not report whether its stored consent choice is a rejection (it expires by Sun, 28 Feb 2027, 10:00 (Europe/London) at the latest)',
    );
    expect(c.check.state).toBe('warn');
    expect(c.cause).toBe('cannot-check');
    expect(c.check.summary).not.toContain('rejected');
  });
  it('a record with a stated expiry but no mark states that expiry', () => {
    const c = consentOutcome(
      { now: NOW, tz: 'Europe/London', mode: 'native' },
      healthyWorker({
        read: {
          kind: 'ok',
          status: okWorkerStatus({
            consent: {
              kind: 'socs',
              expiresAt: asIsoDateTime('2027-03-31T10:00:00.000Z'),
              boundedBy: 'cookie',
              mark: null,
            },
          }),
        },
      }),
    );
    expect(c.check.summary).toContain('expires by Wed, 31 Mar 2027, 11:00 (Europe/London) at the latest');
    expect(c.check.fix).toEqual({
      text: 'update the app and the worker together',
      command: 'pnpm gmt update',
    });
  });
  // why: CodeRabbit (PR #18): a stated expiry already passed fails as expired, the mark unreported
  it('a stated expiry already passed, with no mark, has expired on that date', () => {
    const c = consentOutcome(
      { now: NOW, tz: 'Europe/London', mode: 'native' },
      healthyWorker({
        read: {
          kind: 'ok',
          status: okWorkerStatus({
            consent: { kind: 'socs', expiresAt: ago(DAY), boundedBy: 'cookie', mark: null },
          }),
        },
      }),
    );
    expect(c.cause).toBe('expired');
    expect(c.check.state).toBe('fail');
    expect(c.check.summary).toMatch(/^consent expired on .+ \(Europe\/London\)$/);
  });
  it('past the bound it has expired, whatever its mark', () => {
    const c = older('2025-01-31T10:00:00.000Z', asIsoDateTime('2027-02-02T00:00:00.000Z'));
    expect(c.check.state).toBe('fail');
    expect(c.cause).toBe('expired');
    expect(c.check.summary).toBe('consent expired on Sat, 28 Feb 2026, 10:00 (Europe/London)');
  });
});

describe('the email card reports the newest send of any kind (V7)', () => {
  it('a failed alert is a fail naming its kind; a failed notice or test likewise', () => {
    for (const [kind, word] of [
      ['digest', 'alert'],
      ['operator', 'notice'],
      ['system', 'notice'],
      ['test', 'test'],
    ] as const) {
      const c = checkOf(
        healthyFacts({ email: { configured: true, last: { at: ago(HOUR), kind, result: 'failed' } } }),
        'email',
      );
      expect(c.state).toBe('fail');
      expect(c.summary).toContain(`the last ${word} email failed`);
    }
  });
  it('a send held back at the limit is ok and says so', () => {
    const c = checkOf(
      healthyFacts({
        email: { configured: true, last: { at: ago(HOUR), kind: 'digest', result: 'refused' } },
      }),
      'email',
    );
    expect(c.state).toBe('ok');
    expect(c.summary).toContain('held back at the hourly limit');
  });
});

// Spec §10 `GET /status`: the report's schema, its worst-first order and the bar line (brief WP18 §5, Task 18.1).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  barSummary,
  ROUTES,
  STATE_ORDER,
  type StatusCheck,
  sortChecks,
  statusCheckSchema,
  statusResponseSchema,
  testEmailResponseSchema,
} from '../../src/api-contract/index.js';

const check = (over: Partial<StatusCheck> = {}): StatusCheck => ({
  id: 'app',
  area: 'app',
  providerId: null,
  label: null,
  state: 'ok',
  summary: 'running',
  note: null,
  offReason: null,
  fix: null,
  ...over,
});

describe('statusCheckSchema', () => {
  it('accepts a plain check and refuses an unknown field', () => {
    expect(statusCheckSchema.safeParse(check()).success).toBe(true);
    expect(statusCheckSchema.safeParse({ ...check(), extra: 1 }).success).toBe(false);
  });
  it('sets offReason exactly when the state is off', () => {
    expect(statusCheckSchema.safeParse(check({ offReason: 'not-set-up' })).success).toBe(false);
    expect(statusCheckSchema.safeParse(check({ state: 'off' })).success).toBe(false);
    expect(statusCheckSchema.safeParse(check({ state: 'off', offReason: 'not-visible' })).success).toBe(true);
  });
  it('allows a fix command only as a pnpm gmt line', () => {
    const fix = (command: string | null) => check({ fix: { text: 'do it', command } });
    expect(statusCheckSchema.safeParse(fix('pnpm gmt start')).success).toBe(true);
    expect(statusCheckSchema.safeParse(fix(null)).success).toBe(true);
    expect(statusCheckSchema.safeParse(fix('rm -rf /')).success).toBe(false);
    expect(statusCheckSchema.safeParse(fix('pnpm gmt')).success).toBe(false);
  });
  it('bounds the id, the summary and the note', () => {
    expect(statusCheckSchema.safeParse(check({ id: 'Bad Id' })).success).toBe(false);
    expect(statusCheckSchema.safeParse(check({ summary: 'x'.repeat(601) })).success).toBe(false);
    expect(statusCheckSchema.safeParse(check({ summary: 'x'.repeat(600) })).success).toBe(true);
    expect(statusCheckSchema.safeParse(check({ note: 'x'.repeat(601) })).success).toBe(false);
  });
});

describe('statusResponseSchema', () => {
  it('is strict and takes a mode', () => {
    const base = { generatedAt: '2026-10-14T09:00:00.000Z', mode: 'native', version: 'abc1234', checks: [] };
    expect(statusResponseSchema.safeParse(base).success).toBe(true);
    expect(statusResponseSchema.safeParse({ ...base, mode: 'other' }).success).toBe(false);
    expect(statusResponseSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
  it('is mounted as GET /api/status, and the test email as a POST', () => {
    expect(ROUTES.find((r) => r.method === 'GET' && r.path === '/api/status')?.response).toBe(
      statusResponseSchema,
    );
    const post = ROUTES.find((r) => r.method === 'POST' && r.path === '/api/alerts/test-email');
    expect(post?.response).toBe(testEmailResponseSchema);
    expect(post?.request).toBeUndefined();
  });
});

describe('sortChecks', () => {
  it('orders fail, warn, ok, off, then area, then id, without changing its argument', () => {
    const input = [
      check({ id: 'z-off', area: 'app', state: 'off', offReason: 'not-set-up' }),
      check({ id: 'b-ok', area: 'worker', state: 'ok' }),
      check({ id: 'a-ok', area: 'worker', state: 'ok' }),
      check({ id: 'db-ok', area: 'database', state: 'ok' }),
      check({ id: 'w', area: 'email', state: 'warn' }),
      check({ id: 'f2', area: 'worker', state: 'fail' }),
      check({ id: 'f1', area: 'schedule', state: 'fail' }),
    ];
    const copy = [...input];
    expect(sortChecks(input).map((c) => c.id)).toEqual(['f1', 'f2', 'w', 'db-ok', 'a-ok', 'b-ok', 'z-off']);
    expect(input).toEqual(copy);
  });
  it('orders by id within a state and area, whichever order they arrive in', () => {
    const lo = check({ id: 'a' });
    const hi = check({ id: 'b' });
    expect(sortChecks([lo, hi]).map((c) => c.id)).toEqual(['a', 'b']);
    expect(sortChecks([hi, lo]).map((c) => c.id)).toEqual(['a', 'b']);
  });
  it('orders many checks that share a state and an area by id, in every permutation tried', () => {
    const ids = ['m', 'c', 'x', 'a', 'q', 'f'];
    const sorted = [...ids].sort();
    fc.assert(
      fc.property(fc.shuffledSubarray(ids, { minLength: ids.length, maxLength: ids.length }), (order) => {
        expect(sortChecks(order.map((id) => check({ id }))).map((c) => c.id)).toEqual(sorted);
      }),
    );
  });
  it('allows the disabled reason and a label', () => {
    expect(
      statusCheckSchema.safeParse(check({ state: 'off', offReason: 'disabled', label: 'London to New York' }))
        .success,
    ).toBe(true);
  });
  it('keeps checks that tie on state, area and id in their given order', () => {
    const a = check({ summary: 'first' });
    const b = check({ summary: 'second' });
    expect(sortChecks([a, b]).map((c) => c.summary)).toEqual(['first', 'second']);
    expect(sortChecks([b, a]).map((c) => c.summary)).toEqual(['second', 'first']);
  });
  it('keeps STATE_ORDER worst first', () => {
    expect(STATE_ORDER).toEqual({ fail: 0, warn: 1, ok: 2, off: 3 });
  });
});

describe('barSummary', () => {
  it('is clean for ok checks (notes included) and off checks', () => {
    const r = barSummary([
      check({ note: 'caught up the run missed at 01:30, ran 07:02' }),
      check({ id: 'x', state: 'off', offReason: 'not-set-up' }),
    ]);
    expect(r.kind).toBe('clean');
    expect(r.text).toBe('Status: nothing to check');
    expect(barSummary([]).kind).toBe('clean');
  });
  it('names the area for one item and counts for several', () => {
    expect(barSummary([check({ area: 'schedule', state: 'fail' })])).toEqual({
      kind: 'fail',
      text: 'Status: schedule failing',
    });
    expect(
      barSummary([
        check({ area: 'schedule', state: 'fail' }),
        check({ id: 'b', area: 'app', state: 'fail' }),
      ]),
    ).toEqual({ kind: 'fail', text: 'Status: 2 failing' });
    expect(barSummary([check({ area: 'consent', state: 'warn' })])).toEqual({
      kind: 'warn',
      text: 'Status: consent to check',
    });
    expect(
      barSummary([
        check({ area: 'consent', state: 'warn' }),
        check({ id: 'b', area: 'data', state: 'warn' }),
      ]),
    ).toEqual({ kind: 'warn', text: 'Status: 2 to check' });
  });
  it('lets a failure outrank warnings and counts only the failures', () => {
    expect(
      barSummary([
        check({ id: 'a', area: 'consent', state: 'warn' }),
        check({ id: 'b', area: 'data', state: 'warn' }),
        check({ id: 'c', area: 'worker', state: 'fail' }),
      ]),
    ).toEqual({ kind: 'fail', text: 'Status: worker failing' });
  });
});

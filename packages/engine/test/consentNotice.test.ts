// Spec §8.3 "Consent expiry" (brief WP18 Task 18.4): the maintenance tick sends one system notice a London day while the
// consent check is warn or fail and the browser provider is enabled, through sendSystemNotice, with no
// operator_notifications row.
import { findBannedWords, type Notifier } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { runConsentNotice, runSystemJob } from '../src/maintenance.js';
import { sendSystemNotice } from '../src/notify.js';
import type { ConsentCheck } from '../src/types.js';
import { createHarness, type Harness } from './support/harness.js';

const BROWSER_ENV = {
  CAMOUFOX_ENABLED: 'true',
  CAMOUFOX_WORKER_URL: 'http://127.0.0.1:8090',
  CAMOUFOX_WORKER_KEY: 'test-worker-key-0123456789abcdef',
};

type Sent = Extract<Parameters<Notifier['send']>[0], { kind: 'system' }>;
function stubNotifier(sent: Sent[], ok = true): Notifier {
  return {
    id: 'stub',
    send: async (m) => {
      if (m.kind === 'system') sent.push(m);
      return ok ? { ok: true } : { ok: false, detail: 'refused' };
    },
  };
}

function setup(o: { check: ConsentCheck; env?: Record<string, string>; notifiers?: Notifier[] }) {
  const h: Harness = createHarness({ env: { ...BROWSER_ENV, ...o.env } });
  const sent: Sent[] = [];
  const ctx = buildContext(
    { ...h.deps, notifiers: o.notifiers ?? [stubNotifier(sent)] },
    { consentCheck: o.check },
  );
  return { h, sent, ctx };
}
const state =
  (s: 'ok' | 'warn' | 'fail' | 'off'): ConsentCheck =>
  async () => ({
    state: s,
    summary: 'consent rejected, expires 2026-11-01 (capture); under 30 days left',
    fix: 'capture consent again: pnpm gmt consent',
  });
const count = (h: Harness, table: string) =>
  h.db.raw.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? 0;

describe('the consent notice on the maintenance tick (spec §8.3)', () => {
  it.each(['warn', 'fail'] as const)('a %s check sends one system notice to every notifier', async (s) => {
    const { h, sent, ctx } = setup({ check: state(s) });
    await runSystemJob(ctx, 'maintenance');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.kind).toBe('system');
    expect(sent[0]?.subject).toBe(
      s === 'fail' ? 'browser provider consent has expired' : 'browser provider consent expires soon',
    );
    expect(sent[0]?.body).toContain('capture consent again');
    expect(findBannedWords(`${sent[0]?.subject} ${sent[0]?.body}`)).toEqual([]);
    expect(h.repos.notifications.noticeKeyClaimed(`consent-expiring:${ctx.clock.todayLondon()}`)).toBe(true);
  });

  it('a second tick the same London day sends nothing and the next day sends again', async () => {
    const { h, sent, ctx } = setup({ check: state('warn') });
    expect(await runConsentNotice(ctx)).toBe(true);
    h.clock.advance(3_600_000);
    expect(await runConsentNotice(ctx)).toBe(false);
    expect(sent).toHaveLength(1);
    h.clock.advance(24 * 3_600_000);
    expect(await runConsentNotice(ctx)).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it('ok, off, a disabled browser provider or no notifier sends nothing and claims nothing', async () => {
    for (const s of ['ok', 'off'] as const) {
      const { h, sent, ctx } = setup({ check: state(s) });
      expect(await runConsentNotice(ctx)).toBe(false);
      expect(sent).toEqual([]);
      expect(count(h, 'operator_notice_keys')).toBe(0);
    }
    const off = setup({ check: state('fail'), env: { CAMOUFOX_ENABLED: 'false' } });
    expect(await runConsentNotice(off.ctx)).toBe(false);
    expect(off.sent).toEqual([]);
    const none = setup({ check: state('fail'), notifiers: [] });
    expect(await runConsentNotice(none.ctx)).toBe(false);
    expect(count(none.h, 'operator_notice_keys')).toBe(0);
  });

  it('writes no operator_notifications row, adds no kind and the message holds no SOCS value', async () => {
    const { h, sent, ctx } = setup({ check: state('fail') });
    await runSystemJob(ctx, 'maintenance');
    expect(count(h, 'operator_notifications')).toBe(0);
    expect(JSON.stringify(sent)).not.toMatch(/SOCS/);
  });

  it('an engine without a consent check never sends one', async () => {
    const h = createHarness({ env: BROWSER_ENV });
    const ctx = buildContext(h.deps);
    expect(await runConsentNotice(ctx)).toBe(false);
  });

  it('a check that throws is logged by the tick and does not stop it', async () => {
    const { h, ctx } = setup({
      check: async () => {
        throw new Error('worker unreachable');
      },
    });
    await runSystemJob(ctx, 'maintenance');
    expect(h.logs.some((l) => l.msg === 'system job failed')).toBe(true);
  });
});

describe('sendSystemNotice', () => {
  it('reports a refusing and a throwing notifier as not sent, and never throws', async () => {
    const h = createHarness();
    const sent: Sent[] = [];
    const throwing: Notifier = {
      id: 'boom',
      send: async () => {
        throw new Error('smtp down');
      },
    };
    const ctx = { notifiers: [stubNotifier(sent, false), throwing], log: h.deps.log };
    expect(await sendSystemNotice(ctx, 's', 'b')).toBe(false);
    expect(sent).toHaveLength(1);
    expect(await sendSystemNotice({ notifiers: [], log: h.deps.log }, 's', 'b')).toBe(false);
    expect(await sendSystemNotice({ notifiers: [stubNotifier([])], log: h.deps.log }, 's', 'b')).toBe(true);
  });
});

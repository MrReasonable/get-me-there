// Spec §8.3 "Consent expiry" (brief WP18 Task 18.4, review V2): one system notice a London day while the consent check is
// warn or fail for a cause it can name and the browser provider is enabled, sent by the 03:30 job and by the minute job,
// claimed only after a successful send, with no operator_notifications row.
import { asIsoDateTime, findBannedWords, type Notifier } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { CONSENT_RECHECK_MS, runConsentNotice, runConsentNoticeSafely } from '../src/consentNotice.js';
import { buildContext } from '../src/context.js';
import { runSystemJob } from '../src/maintenance.js';
import { sendSystemNotice } from '../src/notify.js';
import type { ConsentCause, ConsentCheck } from '../src/types.js';
import { createHarness, type Harness } from './support/harness.js';

const BROWSER_ENV = {
  CAMOUFOX_ENABLED: 'true',
  CAMOUFOX_WORKER_URL: 'http://127.0.0.1:8090',
  CAMOUFOX_WORKER_KEY: 'test-worker-key-0123456789abcdef',
};

type Sent = Extract<Parameters<Notifier['send']>[0], { kind: 'system' }>;
function stubNotifier(sent: Sent[], ok: () => boolean = () => true): Notifier {
  return {
    id: 'stub',
    send: async (m) => {
      if (m.kind === 'system') sent.push(m);
      return ok() ? { ok: true } : { ok: false, detail: 'refused' };
    },
  };
}

function setup(o: {
  check: ConsentCheck;
  env?: Record<string, string>;
  notifiers?: Notifier[];
  now?: string;
}) {
  const h: Harness = createHarness({
    env: { ...BROWSER_ENV, ...o.env },
    ...(o.now === undefined ? {} : { now: asIsoDateTime(o.now) }),
  });
  const sent: Sent[] = [];
  const ctx = buildContext(
    { ...h.deps, notifiers: o.notifiers ?? [stubNotifier(sent)] },
    { consentCheck: o.check },
  );
  return { h, sent, ctx };
}
const check =
  (
    s: 'ok' | 'warn' | 'fail' | 'off',
    cause: ConsentCause = 'expiring',
    fix: string | null = 'capture consent again with the capture script (docs/setup.md section 14)',
  ): ConsentCheck =>
  async () => ({
    state: s,
    cause: s === 'ok' || s === 'off' ? 'none' : cause,
    summary: 'consent rejected, expires 2026-11-01 (capture)',
    fix,
  });
const count = (h: Harness, table: string) =>
  h.db.raw.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? 0;

describe('the subject comes from the cause, not the state (V2)', () => {
  it.each([
    ['warn', 'expiring', 'browser provider consent expires soon'],
    ['fail', 'expired', 'browser provider consent has expired'],
    ['fail', 'missing', 'browser provider has no consent record'],
    ['fail', 'voided', 'browser provider consent screen is now shown'],
  ] as const)(
    '%s / %s sends "%s" with the consequence and the fix in their own sentences',
    async (s, cause, subject) => {
      const { h, sent, ctx } = setup({ check: check(s, cause) });
      await runSystemJob(ctx, 'maintenance');
      expect(sent).toHaveLength(1);
      expect(sent[0]?.subject).toBe(subject);
      const body = sent[0]?.body ?? '';
      expect(body).toContain(
        'Browser prices stop when consent lapses; the other price sources are unaffected.',
      );
      expect(body).toContain(
        'What to do: Capture consent again with the capture script (docs/setup.md section 14).',
      );
      expect(body).toContain('pnpm gmt status --only consent');
      expect(findBannedWords(`${subject} ${body}`)).toEqual([]);
      expect(h.repos.notifications.noticeKeyClaimed(`consent-expiring:${ctx.clock.todayLondon()}`)).toBe(
        true,
      );
      expect(count(h, 'operator_notifications')).toBe(0);
      expect(body).not.toMatch(/SOCS/);
    },
  );

  it('a check that cannot be made sends nothing and claims nothing (the worker card says that)', async () => {
    const { h, sent, ctx } = setup({ check: check('warn', 'cannot-check') });
    await runSystemJob(ctx, 'maintenance');
    expect(sent).toEqual([]);
    expect(count(h, 'operator_notice_keys')).toBe(0);
  });

  it('a check with no fix still sends, with no "What to do" line', async () => {
    const { sent, ctx } = setup({ check: check('fail', 'expired', null) });
    await runConsentNotice(ctx, { force: true });
    expect(sent[0]?.body).not.toContain('What to do');
  });
});

describe('every notifier gets the notice (CodeRabbit)', () => {
  it('two notifiers that both accept each receive the same notice, and the day is claimed once', async () => {
    const a: Sent[] = [];
    const b: Sent[] = [];
    const { h, ctx } = setup({ check: check('warn'), notifiers: [stubNotifier(a), stubNotifier(b)] });
    expect(await runConsentNotice(ctx, { force: true })).toBe(true);
    expect(a).toHaveLength(1);
    expect(b).toEqual(a);
    expect(count(h, 'operator_notice_keys')).toBe(1);
  });
});

describe('once a London day, without losing it (V2)', () => {
  it('a second pass the same day sends nothing and the next day sends again', async () => {
    const { h, sent, ctx } = setup({ check: check('warn') });
    expect(await runConsentNotice(ctx, { force: true })).toBe(true);
    h.clock.advance(3_600_000);
    expect(await runConsentNotice(ctx, { force: true })).toBe(false);
    h.clock.advance(24 * 3_600_000);
    expect(await runConsentNotice(ctx, { force: true })).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it('the London midnight is the edge, not the UTC one: 22:59Z and 23:01Z in summer are two days', async () => {
    const { h, sent, ctx } = setup({ check: check('warn'), now: '2026-07-14T22:59:00.000Z' });
    expect(await runConsentNotice(ctx, { force: true })).toBe(true);
    h.clock.set(asIsoDateTime('2026-07-14T23:01:00.000Z'));
    expect(await runConsentNotice(ctx, { force: true })).toBe(true);
    expect(sent).toHaveLength(2);
    h.clock.set(asIsoDateTime('2026-07-14T23:30:00.000Z'));
    expect(await runConsentNotice(ctx, { force: true })).toBe(false);
  });

  it('a failed send does not use up the day: the next pass sends it', async () => {
    const sent: Sent[] = [];
    let up = false;
    const { h, ctx } = setup({ check: check('warn'), notifiers: [stubNotifier(sent, () => up)] });
    expect(await runConsentNotice(ctx, { force: true })).toBe(false);
    expect(count(h, 'operator_notice_keys')).toBe(0);
    up = true;
    expect(await runConsentNotice(ctx, { force: true })).toBe(true);
    expect(count(h, 'operator_notice_keys')).toBe(1);
    expect(sent).toHaveLength(2);
  });

  it('the minute job sends it when the 03:30 job never ran, and re-reads the check at most hourly', async () => {
    let reads = 0;
    const counting: ConsentCheck = async () => {
      reads += 1;
      return check('ok')();
    };
    const asleep = setup({ check: counting });
    expect(await runConsentNotice(asleep.ctx)).toBe(false);
    expect(await runConsentNotice(asleep.ctx)).toBe(false);
    expect(reads).toBe(1);
    asleep.h.clock.advance(CONSENT_RECHECK_MS);
    await runConsentNotice(asleep.ctx);
    expect(reads).toBe(2);
    const woken = setup({ check: check('warn') });
    expect(await runConsentNotice(woken.ctx)).toBe(true);
    expect(woken.sent).toHaveLength(1);
  });

  it('two passes at once send once', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: Sent[] = [];
    const slow: ConsentCheck = async () => {
      await gate;
      return check('warn')();
    };
    const { ctx } = setup({ check: slow, notifiers: [stubNotifier(sent)] });
    const first = runConsentNotice(ctx, { force: true });
    expect(await runConsentNotice(ctx, { force: true })).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(sent).toHaveLength(1);
  });
});

describe('when nothing is sent', () => {
  it('ok, off, a disabled browser provider or no notifier sends nothing and claims nothing', async () => {
    for (const s of ['ok', 'off'] as const) {
      const { h, sent, ctx } = setup({ check: check(s) });
      expect(await runConsentNotice(ctx, { force: true })).toBe(false);
      expect(sent).toEqual([]);
      expect(count(h, 'operator_notice_keys')).toBe(0);
    }
    const off = setup({ check: check('fail', 'expired'), env: { CAMOUFOX_ENABLED: 'false' } });
    expect(await runConsentNotice(off.ctx, { force: true })).toBe(false);
    const none = setup({ check: check('fail', 'expired'), notifiers: [] });
    expect(await runConsentNotice(none.ctx, { force: true })).toBe(false);
    expect(count(none.h, 'operator_notice_keys')).toBe(0);
  });

  it('an engine without a consent check never sends one', async () => {
    const h = createHarness({ env: BROWSER_ENV });
    expect(await runConsentNotice(buildContext(h.deps), { force: true })).toBe(false);
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

describe('the minute job’s pass', () => {
  it('a check that throws is logged with its cause and never stops the catch-up that called it', async () => {
    const { h, ctx } = setup({
      check: async () => {
        throw new Error('worker unreachable');
      },
    });
    await expect(runConsentNoticeSafely(ctx)).resolves.toBeUndefined();
    const line = h.logs.find((l) => l.msg === 'consent notice failed');
    expect(line?.fields).toMatchObject({ err: expect.stringContaining('worker unreachable') });
  });
  it('a pass that sends is not logged as a failure', async () => {
    const { h, sent, ctx } = setup({ check: check('warn') });
    await runConsentNoticeSafely(ctx);
    expect(sent).toHaveLength(1);
    expect(h.logs.some((l) => l.msg === 'consent notice failed')).toBe(false);
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
    const ctx = { notifiers: [stubNotifier(sent, () => false), throwing], log: h.deps.log };
    expect(await sendSystemNotice(ctx, 's', 'b')).toBe(false);
    expect(sent).toHaveLength(1);
    expect(await sendSystemNotice({ notifiers: [], log: h.deps.log }, 's', 'b')).toBe(false);
    expect(await sendSystemNotice({ notifiers: [stubNotifier([])], log: h.deps.log }, 's', 'b')).toBe(true);
  });
});

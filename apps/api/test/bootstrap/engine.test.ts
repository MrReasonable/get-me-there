import { asIsoDateTime, fixedClock } from '@gmt/core';
import { MIGRATIONS_DIR } from '@gmt/db';
import * as engine from '@gmt/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { engineFor } from '../../src/bootstrap/engine.js';
import { buildPorts, loadConfigFromEnv } from '../../src/wiring.js';
import { SENTINEL_SMTP, silentLog, testEnv } from '../helpers/env.js';
import { onCleanup } from '../helpers/tmp.js';

function ports(extra: Record<string, string> = {}) {
  const p = buildPorts(loadConfigFromEnv(testEnv(extra)), {
    log: silentLog,
    clock: fixedClock(asIsoDateTime('2026-10-20T09:00:00.000Z')),
    migrationsDir: MIGRATIONS_DIR,
  });
  onCleanup(() => p.db.close());
  return p;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('engineFor: the production engine wiring (spec §8.1, §8.3; review TS-6)', () => {
  it('passes WP11 runAlerts as the alerts step and the log notifier alone without SMTP', () => {
    const spy = vi.spyOn(engine, 'createEngine');
    engineFor(ports(), silentLog);
    expect(spy).toHaveBeenCalledTimes(1);
    const [deps, opts] = spy.mock.calls[0] ?? [];
    expect(opts?.alerts).toBe(engine.runAlerts);
    expect(deps?.notifiers.map((n) => n.id)).toEqual(['log']);
  });

  it('adds the EmailNotifier when SMTP_* is configured', () => {
    const spy = vi.spyOn(engine, 'createEngine');
    engineFor(
      ports({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '465',
        SMTP_USER: 'alerts',
        SMTP_PASS: SENTINEL_SMTP,
        ALERT_EMAIL_TO: 'operator@example.com',
        ALERT_EMAIL_FROM: 'get-me-there@example.com',
      }),
      silentLog,
    );
    expect(spy.mock.calls[0]?.[0].notifiers.map((n) => n.id)).toEqual(['log', 'email']);
  });
});

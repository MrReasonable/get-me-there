/**
 * The app's engine (spec §8.1, §8.3): the notifiers config asks for (the log always, email when SMTP_* is set, with the
 * ALERT_EMAIL_MAX_PER_HOUR ceiling) and WP11's alert runner as the alerts step. WP8's bootApp calls it, so the
 * production wiring has a test of its own (review TS-6).
 */
import type { Logger } from '@gmt/core';
import { buildNotifiers, createEngine, type Engine, runAlerts } from '@gmt/engine';
import type { Ports } from '../wiring.js';

export function engineFor(ports: Ports, log: Logger): Engine {
  return createEngine(
    { ...ports, notifiers: buildNotifiers(ports.config, log, ports.clock) },
    { alerts: runAlerts },
  );
}

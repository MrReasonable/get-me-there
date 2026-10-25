/**
 * The app's engine (spec §8.1, §8.3): the notifiers config asks for (the log always, email when SMTP_* is set, with the
 * ALERT_EMAIL_MAX_PER_HOUR ceiling), WP11's alert runner as the alerts step and the Status view's consent check for the
 * maintenance tick's consent notice. WP8's bootApp calls it, so the production wiring has a test of its own (review TS-6).
 */
import type { Logger, Notifier } from '@gmt/core';
import { buildNotifiers, createEngine, type Engine, runAlerts } from '@gmt/engine';
import { consentCheckFor } from '../read/statusSources.js';
import type { Ports } from '../wiring.js';

export function engineFor(
  ports: Ports,
  log: Logger,
  extra: { notifiers?: Notifier[]; home?: string | null } = {},
): Engine {
  const notifiers = extra.notifiers ?? buildNotifiers(ports.config, log, ports.clock);
  return createEngine(
    { ...ports, notifiers },
    { alerts: runAlerts, consentCheck: () => consentCheckFor(ports, extra.home ?? null) },
  );
}

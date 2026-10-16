import type { AlertsStepHook } from './types.js';

/** The default alerts step: no rules evaluated, nothing sent. WP11's runAlerts replaces it through createEngine(deps, { alerts }). */
export const noAlerts: AlertsStepHook = async () => ({ digests: 0, events: 0 });

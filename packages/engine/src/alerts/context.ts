/** What every part of the alert runner shares for one run of the alerts step (spec §6.8, §8.1). */
import type { DefinitionSnapshot, IsoDateTime, Logger, SearchDefinition } from '@gmt/core';
import type { AlertsPass, EngineDeps } from '../types.js';

/** What the runner needs from the engine's dependencies; EngineDeps satisfies it, so runAlerts is an AlertsStepHook. */
export type AlertRunnerDeps = Pick<
  EngineDeps,
  'config' | 'db' | 'repos' | 'providers' | 'notifiers' | 'clock' | 'log'
>;

/** One run of the alerts step over one execution. */
export interface AlertRunContext {
  deps: AlertRunnerDeps;
  log: Logger;
  now: IsoDateTime;
  executionId: string;
  definition: SearchDefinition;
  snapshot: DefinitionSnapshot;
  /** How the pass ended: the budget-stop lines and the retry wording depend on it (decision 59). */
  pass: AlertsPass;
}

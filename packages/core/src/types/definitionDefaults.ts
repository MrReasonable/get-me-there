import type { DefinitionInput } from './definition.js';

/** Spec §8.2: weekly, Monday 05:00 in the scheduler's time zone. */
export const DEFAULT_CRON = '0 5 * * 1';

/** The definition fields whose defaults do not depend on the plan or the config. */
export type DefinitionDefaults = Pick<
  DefinitionInput,
  'window' | 'minNights' | 'maxNights' | 'cabin' | 'constraints' | 'verification' | 'scheduleCron' | 'enabled'
>;

/**
 * The spec §11 form defaults, in one place for the api's default definition and the web form's draft (so a spec
 * edit changes both). A fresh object each call, so no caller can mutate another's defaults.
 * `enabled` is false: a new definition schedules nothing until the operator turns it on (no unattended spend by default).
 */
export function definitionDefaults(): DefinitionDefaults {
  return {
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    constraints: { maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' } },
    verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    scheduleCron: DEFAULT_CRON,
    enabled: false,
  };
}

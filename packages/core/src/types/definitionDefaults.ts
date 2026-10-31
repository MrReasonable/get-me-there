import type { DefinitionInput } from './definition.js';

/**
 * Spec §8.2: weekly, Monday 05:00 in the scheduler's time zone. Since revision 55 it is the schedule a search gets when
 * the operator presses Repeat weekly, never a new search's default (design §4).
 */
export const DEFAULT_CRON = '0 5 * * 1';

/** The definition fields whose defaults do not depend on the plan or the config. */
export type DefinitionDefaults = Pick<
  DefinitionInput,
  'window' | 'minNights' | 'maxNights' | 'cabin' | 'constraints' | 'verification' | 'scheduleCron' | 'enabled'
>;

/**
 * The spec §11 form defaults, in one place for the api's default definition and the web form's draft (so a spec
 * edit changes both). A fresh object each call, so no caller can mutate another's defaults.
 * Spec revision 55 (§8.2, design §4): a new search has no schedule (`scheduleCron` null, `enabled` false: nothing runs
 * unattended until the operator presses Repeat weekly) and no arrival window (a default arrival window hid cheap
 * flights the operator never asked to exclude); the journey limit of 25 hours stays.
 */
export function definitionDefaults(): DefinitionDefaults {
  return {
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    constraints: { maxJourneyMinutes: 1500 },
    verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    scheduleCron: null,
    enabled: false,
  };
}

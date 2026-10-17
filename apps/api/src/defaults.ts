/** The plan-aware default definition (spec §8.2 policy preset, §11 form defaults). */
import {
  type Config,
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  type DefinitionInput,
  type FlightProvider,
  type ProviderId,
} from '@gmt/core';

/** Spec §8.2: weekly, Monday 05:00 in SCHEDULER_TIMEZONE. The refresh default is core's DEFAULT_DISCOVERY_REFRESH_HOURS. */
export const DEFAULT_CRON = '0 5 * * 1';

/**
 * The default definition for the configured plan (spec §8.2 policy preset, §11 form defaults).
 * No airports (spec §1, §15). Disabled, so no schedule fires on a draft. No confirmation: `confirmedCostPence` and
 * `confirmedCalls` are not part of DefinitionInput and are set only from an explicit confirmation (spec §7, decision 37).
 */
export function defaultDefinitionInput(
  config: Config,
  providers: readonly FlightProvider[],
): DefinitionInput {
  const configured = new Set(providers.map((p) => p.id));
  const paid = config.providers.searchapi?.plan === '40usd' && configured.has('searchapi');
  const fixture = configured.has('fixture');
  const discovery: ProviderId[] = [];
  if (configured.has('travelpayouts')) discovery.push('travelpayouts');
  if (paid) discovery.push('searchapi');
  if (fixture) discovery.push('fixture');
  // why: on trial the 100 credits are for the spike and smoke (spec §2 fact 7), so the preset never verifies with them.
  const verification: ProviderId[] = [];
  if (paid) verification.push('searchapi');
  if (fixture) verification.push('fixture');
  const discoveryRefreshHours: Partial<Record<ProviderId, number>> = {};
  for (const id of discovery) discoveryRefreshHours[id] = DEFAULT_DISCOVERY_REFRESH_HOURS;
  return {
    name: 'New search',
    origins: [],
    destinations: [],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    constraints: { maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' } },
    verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    budget: {
      maxCalls: config.spend.executionMaxCalls,
      maxFreeCalls: config.spend.executionMaxFreeCalls,
      maxCostMicroGbp: config.spend.executionMaxCostMicroGbp,
    },
    providers: { discovery, verification, discoveryRefreshHours },
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: DEFAULT_CRON,
    scheduleTz: config.schedulerTimezone,
    enabled: false,
  };
}

/** The plan-aware default definition (spec §8.2 policy preset, §11 form defaults). */
import {
  type Config,
  type DefinitionInput,
  definitionDefaults,
  type FlightProvider,
  type ProviderId,
} from '@gmt/core';

/** The provider ids a new search starts with, per role. */
export interface NewSearchSources {
  discovery: ProviderId[];
  verification: ProviderId[];
}

/**
 * The one rule for the sources a new search starts with (settings plan ruling 7, controller ruling R2): the preset on
 * `/providers`, the Settings page's switches and the default definition all read it, so the draft and the page cannot
 * differ. A stored list (NEW_SEARCH_DISCOVERY / NEW_SEARCH_VERIFICATION) names exactly the sources to tick, in its
 * order, minus any this install has not configured; `none` ticks nothing for that role. With no list the draft is
 * today's: every configured free source for discovery (spec revision 55 §2, §8.2: Travelpayouts, and the browser worker
 * only when it is registered), SearchApi ticked nowhere on every plan (its credits are spent only on a search the
 * operator ticks it for, spec §2 fact 7), and the test source on discovery only when no real source is left.
 */
export function newSearchSourcesFor(config: Config, providers: readonly FlightProvider[]): NewSearchSources {
  const configured = new Set(providers.map((p) => p.id));
  const { discovery: listedDiscovery, verification: listedVerification } = config.newSearchSources;
  // why: a listed source drops out when it is not configured, and when it lacks the role's capability (a stored
  // NEW_SEARCH_VERIFICATION naming Travelpayouts would tick a trip check source that cannot check trips)
  const listed = (ids: readonly ProviderId[], role: 'discovery' | 'verification'): ProviderId[] =>
    ids.filter((id) => providers.some((p) => p.id === id && p[role] !== undefined));
  const free: ProviderId[] = [];
  if (configured.has('travelpayouts')) free.push('travelpayouts');
  if (configured.has('camoufox')) free.push('camoufox');
  const fixture: ProviderId[] = configured.has('fixture') ? ['fixture'] : [];
  return {
    discovery:
      listedDiscovery === null ? (free.length > 0 ? free : fixture) : listed(listedDiscovery, 'discovery'),
    verification: listedVerification === null ? fixture : listed(listedVerification, 'verification'),
  };
}

/**
 * The default definition for the configured plan (spec §8.2 policy preset, §11 form defaults).
 * No airports (spec §1, §15). Revision 55 §8.2: no schedule and `enabled` false (a new search runs only when pressed),
 * no arrival window, and the sources of `newSearchSourcesFor`, each refreshed after DISCOVERY_REFRESH_DAYS.
 * No confirmation: `confirmedCostPence` and
 * `confirmedCalls` are not part of DefinitionInput and are set only from an explicit confirmation (spec §7, decision 37).
 */
export function defaultDefinitionInput(
  config: Config,
  providers: readonly FlightProvider[],
): DefinitionInput {
  const { discovery, verification } = newSearchSourcesFor(config, providers);
  const discoveryRefreshHours: Partial<Record<ProviderId, number>> = {};
  for (const id of discovery) discoveryRefreshHours[id] = config.discoveryRefreshDays * 24;
  return {
    name: 'New search',
    origins: [],
    destinations: [],
    ...definitionDefaults(),
    budget: {
      maxCalls: config.spend.executionMaxCalls,
      maxFreeCalls: config.spend.executionMaxFreeCalls,
      maxCostMicroGbp: config.spend.executionMaxCostMicroGbp,
    },
    providers: { discovery, verification, discoveryRefreshHours },
    destinationNotes: {},
    onwardCostPence: {},
    scheduleTz: config.schedulerTimezone,
  };
}

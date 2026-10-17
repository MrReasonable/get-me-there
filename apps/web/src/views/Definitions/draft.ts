import type { DefinitionBody, DefinitionResponse, ProvidersResponse } from '../../api/types.js';

/**
 * The form's model: a definition being edited, in the create schema's *input* shape (plain strings,
 * no brands), so nothing is cast or minted before the API, the one validator, parses it (spec §6.1).
 * The confirmation is not part of it: only the explicit create or confirm click sends one.
 */
export type Draft = Omit<DefinitionBody, 'confirmedCostPence'>;
export type DraftWindow = Draft['window'];

/** Spec §11 default relative window: starts in 7 days, 182 days long. */
export const DEFAULT_RELATIVE: DraftWindow = { kind: 'relative', startOffsetDays: 7, lengthDays: 182 };
/** An absolute window before the operator picks dates; the API rejects it until both are set. */
export const EMPTY_ABSOLUTE: DraftWindow = { kind: 'absolute', from: '', to: '' };

/**
 * Review focus 1: a three-letter code is trimmed and upper-cased on blur; any other text (a city name
 * being typed, say) is only trimmed, so a six-letter city name is never shouted back in capitals.
 */
export function normaliseIata(s: string): string {
  const t = s.trim();
  return /^[A-Za-z]{3}$/.test(t) ? t.toUpperCase() : t;
}

/** Spec §11 defaults; providers, policy, budget and time zone come from the plan preset (`/api/providers` presets). */
export function defaultDraft(presets: ProvidersResponse['presets']): Draft {
  return {
    name: '',
    origins: [],
    destinations: [],
    window: DEFAULT_RELATIVE,
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    constraints: { maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' } },
    verification: { ...presets.policy, alwaysInclude: [] },
    budget: { ...presets.budget },
    providers: structuredClone(presets.providers),
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: '0 5 * * 1',
    scheduleTz: presets.schedulerTimezone,
    enabled: true,
  };
}

/** A stored definition as a draft; `enabled` is carried so saving an edit never re-enables it (review po-011). */
export function definitionToDraft(def: DefinitionResponse): Draft {
  return {
    name: def.name,
    origins: [...def.origins],
    destinations: [...def.destinations],
    window: structuredClone(def.window),
    minNights: def.minNights,
    maxNights: def.maxNights,
    cabin: def.cabin,
    constraints: structuredClone(def.constraints),
    verification: structuredClone(def.verification),
    budget: { ...def.budget },
    providers: structuredClone(def.providers),
    destinationNotes: { ...def.destinationNotes },
    onwardCostPence: { ...def.onwardCostPence },
    scheduleCron: def.scheduleCron,
    scheduleTz: def.scheduleTz,
    enabled: def.enabled,
  };
}

/**
 * Loads the example's route, window, nights, cabin, constraints and notes over the draft.
 * why: providers, policy, budget and schedule stay on the plan preset, so importing the example
 * on a £0 install does not ask for SearchApi.
 */
export function applyExample(d: Draft, ex: Draft): Draft {
  return {
    ...d,
    name: ex.name,
    origins: [...ex.origins],
    destinations: [...ex.destinations],
    window: structuredClone(ex.window),
    minNights: ex.minNights,
    maxNights: ex.maxNights,
    cabin: ex.cabin,
    constraints: structuredClone(ex.constraints),
    destinationNotes: { ...ex.destinationNotes },
    onwardCostPence: { ...ex.onwardCostPence },
  };
}

/** Only notes and costs for destinations still in the list, and no blank notes, are sent. */
function forDestinations<V>(rec: Record<string, V>, destinations: readonly string[]): Record<string, V> {
  return Object.fromEntries(Object.entries(rec).filter(([k, v]) => destinations.includes(k) && v !== ''));
}

/** The create/update body (plan `DefinitionInput`): never `confirmedCostPence`, which only the explicit confirmation sets. */
export function draftToRequest(d: Draft): Draft {
  return {
    ...d,
    destinationNotes: forDestinations(d.destinationNotes, d.destinations),
    onwardCostPence: forDestinations(d.onwardCostPence, d.destinations),
  };
}

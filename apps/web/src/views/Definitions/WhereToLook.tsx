import type { ProviderId } from '@gmt/core';
import type { ProvidersResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import type { CallsLeft } from '../../lib/searchApiCallsLeft.js';
import { sourceConfigured } from '../../lib/sources.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import { navPatch } from '../../state/view.js';
import type { Draft } from './draft.js';

const N = COPY.newSearch;

/** The three sources the panel offers, in the mockup's order (design 2026-11-08 Ruling 13). */
const SOURCES = ['camoufox', 'travelpayouts', 'searchapi'] as const;
type Source = (typeof SOURCES)[number];

/** Whether the draft uses the source: SearchApi counts when it is in either stage (a stored search may verify only). */
function ticked(draft: Draft, id: Source): boolean {
  return draft.providers.discovery.includes(id) || draft.providers.verification.includes(id);
}

/**
 * The draft with a source ticked on or off. The browser and the Aviasales cache are first-pass sources (discovery);
 * SearchApi is ticked into both stages and out of both, and while it checks fares booking options are fetched (spec
 * §5.4, the zod rule too). A source ticked on without a refresh interval takes the install's preset one.
 */
export function withSource(draft: Draft, id: Source, on: boolean, refreshHours: number): Draft {
  const { discovery, verification, discoveryRefreshHours } = draft.providers;
  const without = (list: readonly ProviderId[]) => list.filter((p) => p !== id);
  const toggled = (list: readonly ProviderId[]) => (on ? [...without(list), id] : without(list));
  return {
    ...draft,
    providers: {
      discovery: toggled(discovery),
      verification: id === 'searchapi' ? toggled(verification) : [...verification],
      discoveryRefreshHours:
        on && discoveryRefreshHours[id] === undefined
          ? { ...discoveryRefreshHours, [id]: refreshHours }
          : discoveryRefreshHours,
    },
    verification:
      id === 'searchapi' && on ? { ...draft.verification, bookingLinks: true } : draft.verification,
  };
}

/** A source's cost words: free ones say so; SearchApi says its calls a run (the draft's cap) and the window's left. */
function noteOf(id: Source, draft: Draft, callsLeft: CallsLeft | null): string {
  if (id === 'searchapi') return N.searchapiNote(draft.budget.maxCalls, callsLeft?.left ?? null);
  return N.sourceNote[id];
}

/**
 * "Where to look" (design 2026-11-08 Ruling 13, mockup 01): one checkbox per source the install has set up, each with
 * its cost — "Google Flights, in your browser · free, takes a while", "Aviasales cache · free, prices from other
 * people's searches, often days old", "SearchApi · up to N calls a run, M left" (N the draft's per-run call cap, M the
 * top bar's figure from `searchApiCallsLeft`). A source that is not set up has no checkbox; one sentence names it and
 * links to Settings. The new-search panel and Edit share it, so Edit shows the search's own sources.
 */
export function WhereToLook({
  draft,
  onChange,
  providers,
  callsLeft,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  providers: ProvidersResponse;
  callsLeft: CallsLeft | null;
}) {
  const shown = SOURCES.filter((id) => sourceConfigured(providers, id));
  const unset = SOURCES.filter((id) => !sourceConfigured(providers, id));
  return (
    <fieldset className="where-to-look">
      <legend className="where-to-look-title">{N.whereToLook}</legend>
      {shown.map((id) => (
        <label key={id} htmlFor={`src-${id}`} className="source-check">
          <input
            id={`src-${id}`}
            type="checkbox"
            checked={ticked(draft, id)}
            onChange={(e) =>
              onChange(withSource(draft, id, e.target.checked, providers.presets.discoveryRefreshHours))
            }
          />
          <span>
            {N.source[id]} <span className="source-note">· {noteOf(id, draft, callsLeft)}</span>
          </span>
        </label>
      ))}
      {unset.length === 0 ? null : (
        <p className="source-unset">
          {N.notSetUp(unset.map((id) => N.sourceUnset[id]))}{' '}
          <a href={hrefWith(navPatch('settings'))} onClick={navigateTo(navPatch('settings'))}>
            {N.notSetUpLink}
          </a>
          .
        </p>
      )}
    </fieldset>
  );
}

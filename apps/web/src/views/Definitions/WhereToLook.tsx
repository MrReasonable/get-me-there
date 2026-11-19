import { mainPathSource, type ProviderId } from '@gmt/core';
import type { ProvidersResponse } from '../../api/types.js';
import { SETUP_COPY } from '../../copy/setup.js';
import { COPY } from '../../copy.js';
import type { CreditsLine } from '../../lib/searchApiCreditsLine.js';
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
function withSource(draft: Draft, id: Source, on: boolean, refreshHours: number): Draft {
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

/** The draft with a source taken out of both stages (a source the panel shows only because this search uses it). */
function withoutSource(draft: Draft, id: ProviderId): Draft {
  const without = (list: readonly ProviderId[]) => list.filter((p) => p !== id);
  return {
    ...draft,
    providers: {
      ...draft.providers,
      discovery: without(draft.providers.discovery),
      verification: without(draft.providers.verification),
    },
  };
}

const isOffered = (id: ProviderId): id is Source => SOURCES.some((s) => s === id);

/** A source's cost words: free ones say so; SearchApi that it uses credits, and how many it has left. */
function noteOf(id: Source, credits: CreditsLine | null): string {
  if (id === 'searchapi') return N.searchapiNote(credits?.left ?? null, credits?.tail ?? '');
  return N.sourceNote[id];
}

/**
 * "Where to look" (design 2026-11-08 Ruling 13, mockup 01): one checkbox per source the install has set up, each with
 * its cost: "Google Flights, in your browser · free, takes a while", "Aviasales cache · free, prices from other
 * people's searches, often days old", "SearchApi · uses credits, M left" (M the top bar's figure from
 * `searchApiCreditsLine`; once it is ticked the estimate sentence states the run's own SearchApi calls). A source that is
 * not set up has no checkbox; one sentence names it and links to Settings. A source the search uses that has no
 * checkbox of its own (the test source, or one no longer set up) is listed ticked with why, so the search never reads
 * as having no source, and unticking it takes it out (Task 7 fix round 2). The new-search panel and Edit share it, so
 * Edit shows the search's own sources.
 */
export function WhereToLook({
  draft,
  onChange,
  providers,
  credits,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  providers: ProvidersResponse;
  credits: CreditsLine | null;
}) {
  const shown = SOURCES.filter((id) => sourceConfigured(providers, id));
  const unset = SOURCES.filter((id) => !sourceConfigured(providers, id));
  const used = [...new Set([...draft.providers.discovery, ...draft.providers.verification])];
  const extra = used.filter((id) => !(isOffered(id) && shown.includes(id)));
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
            {N.source[id]} <span className="source-note">· {noteOf(id, credits)}</span>
          </span>
        </label>
      ))}
      {extra.map((id) => (
        <label key={id} htmlFor={`src-${id}`} className="source-check">
          <input
            id={`src-${id}`}
            type="checkbox"
            checked
            onChange={() => onChange(withoutSource(draft, id))}
          />
          <span>
            {isOffered(id) ? N.source[id] : SETUP_COPY.definitions.sourceLabel(mainPathSource(id))}{' '}
            <span className="source-note">
              · {sourceConfigured(providers, id) ? N.sourceInSearch : N.sourceInSearchUnset}
            </span>
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

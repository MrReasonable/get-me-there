import { useProviders } from '../../api/queries.js';
import { COPY } from '../../copy.js';
import { discoverySourceLabel } from '../../lib/sources.js';
import { formatDiscoveryMarker, formatVerificationMarker, providersNotSearched } from './marker.js';
import type { DaySlice } from './types.js';

/**
 * The full six-bucket day marker (spec §11 View B, §3): one line per discovery provider named by its source, a
 * "not searched yet" line for each configured provider with no counts for the day (prov-r2-009), then the
 * itinerary-search line. Shown in the side panel; the day cell carries only the coverage cue (plan decision 38).
 */
export function DayMarker({ slice }: { slice: DaySlice }) {
  const providers = useProviders();
  const C = COPY.calendarView;
  const missing = providersNotSearched(slice);
  return (
    <div className="text-xs text-slate-800" data-testid="day-marker">
      {slice.discoveryProviders.length === 0 ? (
        <p>{C.noDiscoveryProvider}</p>
      ) : slice.discovery.length === 0 ? (
        <p>{C.noRunCoversDay}</p>
      ) : (
        <ul>
          {slice.discovery.map((d) => (
            <li key={d.providerId}>
              {C.markerSource(discoverySourceLabel(d.providerId, providers.data), formatDiscoveryMarker(d))}
            </li>
          ))}
          {missing.map((p) => (
            <li key={p}>{C.providerNotSearched(discoverySourceLabel(p, providers.data))}</li>
          ))}
        </ul>
      )}
      <p>{formatVerificationMarker(slice.verification)}</p>
      {slice.unconfirmedCells > 0 ? (
        <p className="font-semibold">
          {slice.destination === null
            ? C.unconfirmedCells(slice.unconfirmedCells)
            : C.unconfirmedCellsFor(slice.unconfirmedCells, slice.destination)}
        </p>
      ) : null}
      {slice.cheapestPartiallyVerified !== null ? (
        <p>{C.partlyVerified(slice.cheapestPartiallyVerified.count)}</p>
      ) : null}
    </div>
  );
}

/** "(R reused from earlier runs)" for the view header; nothing when R is 0 (spec §3). */
export function ReusedNote({ count }: { count: number }) {
  return count > 0 ? <span>{COPY.reusedNote(count)}</span> : null;
}

import { effectiveAge, formatAgeFull, type IsoDateTime, sourceLabel } from '@gmt/core';
import { COPY } from '../../copy.js';
import { formatIsoDateLong, formatPence } from '../../format.js';
import type { RouteLine } from './lines.js';

const H = COPY.historyView;

/**
 * Every point of one vendor price-history line for one searched trip (ruling 6). Spec §11 exempts these from full
 * provenance, so each row shows the amount (vendor-stated GBP, prov-004) with its source, "indicative", the trip, the
 * cabin, the fetched age and "stale" by fetch age (decision 54), never a PriceCell; the
 * row is marked `data-indicative`, the rendered sweep's one exemption besides the legend's scale (plan decision 52).
 * The only History file allowed to format money.
 */
export function RouteTable({ line, now }: { line: RouteLine; now: IsoDateTime }) {
  const points = line.points.flatMap((p) => (p.kind === 'price' ? [p] : []));
  const cabin = line.cabin === 'unknown' ? H.cabinNotStated : COPY.cabinName[line.cabin];
  return (
    <section aria-label={H.tableScroll(line.name)} className="max-h-64 overflow-auto">
      <table className="w-full text-xs">
        <caption className="text-left font-medium">{H.tableCaption(line.name)}</caption>
        <thead>
          <tr>
            <th scope="col">{H.travelDateColumn}</th>
            <th scope="col">{H.priceColumn}</th>
            <th scope="col">{H.detailColumn}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.t} data-indicative>
              <td>{formatIsoDateLong(p.route.date)}</td>
              <td>
                {/* why: prov-004: every point is vendor-stated GBP, so no "≈"; the title and spoken text say so */}
                <span title={H.routeGbp}>{formatPence(p.pricePence)}</span>
                <span className="sr-only">{H.routeGbp}</span>
                {/* why: decision 54 — stale by fetch age, labelled like every other price */}
                {p.route.stale ? <span className="ml-1 rounded bg-amber-200 px-1">{COPY.stale}</span> : null}
              </td>
              <td>
                {H.routeProvenance(
                  sourceLabel(p.route),
                  line.trip,
                  cabin,
                  formatAgeFull(effectiveAge({ fetchedAt: p.route.fetchedAt, maxAgeHours: 'unknown' }, now)),
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

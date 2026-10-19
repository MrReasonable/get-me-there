import type { ListRequest } from '@gmt/core';
import { airportMatches } from './airports.js';
import type { ListFacts } from './driver.js';
import { INTERSTITIALS, type Interstitial, parseOptionName } from './names.js';
import { pointOfSaleOf } from './pointOfSale.js';

/**
 * The list reader (spec §2 list mode; brief Task 14.3; prov-001, prov-005, PIE-R2-10, TS-19). Every result link is
 * either priced for this cell, counted as another cell's (another day or airport), or counted as unparsed (a name the
 * grammar refuses, an empty name, or one too long or unreadable): `optionsUnparsed + optionsOtherCell +
 * parsedForThisCell === names.length` always. The cell's minimum is over its own options only; the Cheapest tab's price,
 * currency and point of sale are read as stated.
 */
export interface ListRead {
  minMinor: number | null;
  tabMinor: number | null;
  optionsUnparsed: number;
  optionsOtherCell: number;
  parsedForThisCell: number;
  resultsStated: number | null;
  resultsSeen: number;
  currency: string | null;
  pointOfSale: string;
}

/** "Cheapest from 451 British pounds" or "Cheapest from £1,204" → pence; null when the name states no price. */
export function tabPriceMinor(name: string): number | null {
  const m =
    /([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+) British pounds/.exec(name) ??
    /£([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)/.exec(name);
  const digits = m?.[1];
  return digits === undefined ? null : Number(digits.replaceAll(',', '')) * 100;
}

export function readList(
  f: ListFacts,
  req: Pick<ListRequest, 'departureDate' | 'airportNames'>,
  interstitials: readonly Interstitial[] = INTERSTITIALS,
): ListRead {
  const dep = new Date(`${req.departureDate}T00:00:00.000Z`);
  const mine: number[] = [];
  let unparsed = 0;
  let other = 0;
  for (const name of f.names) {
    const p = name === null || name === '' ? null : parseOptionName(name, interstitials);
    if (p === null) unparsed++;
    else if (
      p.departsOn.month === dep.getUTCMonth() + 1 &&
      p.departsOn.day === dep.getUTCDate() &&
      airportMatches(p.from, req.airportNames.origin) &&
      airportMatches(p.to, req.airportNames.destination)
    )
      mine.push(p.amountMinor);
    else other++;
  }
  mine.sort((a, b) => a - b);
  const currency =
    f.currencyName === null ? null : (/^Currency ([A-Z]{3})$/.exec(f.currencyName)?.[1] ?? null);
  return {
    minMinor: mine[0] ?? null,
    tabMinor: tabPriceMinor(f.cheapestTabName),
    optionsUnparsed: unparsed,
    optionsOtherCell: other,
    parsedForThisCell: mine.length,
    resultsStated: f.resultsStated,
    resultsSeen: f.names.length,
    currency,
    pointOfSale: pointOfSaleOf(f.locationName),
  };
}

import type { ListRequest } from '@gmt/core';
import { airportMatches } from './airports.js';
import { cheapestTabPriceMinor } from './classify.js';
import type { ListFacts } from './driver.js';
import { INTERSTITIALS, type Interstitial, type ParsedOption, parseOptionName } from './names.js';
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

/**
 * "Cheapest from 451 British pounds" or "Cheapest from £1,204" → pence; null when the name states no price at its start
 * (the selectors' dated tab-price grammar; the pop-up text after it is never read).
 */
export function tabPriceMinor(name: string): number | null {
  return cheapestTabPriceMinor(name);
}

/** One of the cell's options as the grammar read it, with the name it was read from (spec rev 56 §2). */
export interface MyOption {
  option: ParsedOption;
  /** The link's whole name: the return phase activates the selected option by it, and it never reaches an answer. */
  name: string;
}

/**
 * The list read with the cell's own parsed options, in page order (spec rev 55 §2: the flights reader, `flights.ts`,
 * reuses this cell filter and minimum, then keeps the 30 cheapest of `mine`). Spec rev 56 §2 (WP21 Task 21.3): each
 * option keeps its name, so the return phase can activate the one it selects; `readList` reads the same list.
 */
export function readOptions(
  f: ListFacts,
  req: Pick<ListRequest, 'departureDate' | 'airportNames'>,
  interstitials: readonly Interstitial[] = INTERSTITIALS,
): { list: ListRead; mine: MyOption[] } {
  const dep = new Date(`${req.departureDate}T00:00:00.000Z`);
  const mine: MyOption[] = [];
  let unparsed = 0;
  let other = 0;
  for (const name of f.names) {
    const p = name === null || name === '' ? null : parseOptionName(name, interstitials);
    // why: `name === null` narrows the name kept below (a null or empty name never parses)
    if (name === null || p === null) unparsed++;
    else if (
      p.departsOn.month === dep.getUTCMonth() + 1 &&
      p.departsOn.day === dep.getUTCDate() &&
      airportMatches(p.from, req.airportNames.origin) &&
      airportMatches(p.to, req.airportNames.destination)
    )
      mine.push({ option: p, name });
    else other++;
  }
  const prices = mine.map((p) => p.option.amountMinor).sort((a, b) => a - b);
  const currency =
    f.currencyName === null ? null : (/^Currency ([A-Z]{3})$/.exec(f.currencyName)?.[1] ?? null);
  return {
    list: {
      minMinor: prices[0] ?? null,
      tabMinor: tabPriceMinor(f.cheapestTabName),
      optionsUnparsed: unparsed,
      optionsOtherCell: other,
      parsedForThisCell: mine.length,
      resultsStated: f.resultsStated,
      resultsSeen: f.names.length,
      currency,
      pointOfSale: pointOfSaleOf(f.locationName),
    },
    mine,
  };
}

export function readList(
  f: ListFacts,
  req: Pick<ListRequest, 'departureDate' | 'airportNames'>,
  interstitials: readonly Interstitial[] = INTERSTITIALS,
): ListRead {
  return readOptions(f, req, interstitials).list;
}

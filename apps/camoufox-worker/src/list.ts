import type { ListRequest, Logger } from '@gmt/core';
import { airportMatches } from './airports.js';
import { cheapestTabPriceMinor } from './classify.js';
import type { ListFacts } from './driver.js';
import { INTERSTITIALS, type Interstitial, type ParsedOption, parseOptionName } from './names.js';
import { PAGE_ERROR_TEXT_MAX, withoutQueries } from './pageErrors.js';
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
 * One option that was not counted for the cell, with its whole name (null when the link had none): `unparsed` when the
 * grammar refused the name, `other-cell` when it was read for another day or another airport. Only the worker's own
 * debug log carries these, so a list that finds nothing for its cell can be diagnosed (2026-11-03); never an answer.
 */
export interface SkippedOption {
  why: 'unparsed' | 'other-cell';
  name: string | null;
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
): { list: ListRead; mine: MyOption[]; skipped: SkippedOption[] } {
  const dep = new Date(`${req.departureDate}T00:00:00.000Z`);
  const mine: MyOption[] = [];
  const skipped: SkippedOption[] = [];
  for (const name of f.names) {
    const p = name === null || name === '' ? null : parseOptionName(name, interstitials);
    // why: `name === null` narrows the name kept below (a null or empty name never parses)
    if (name === null || p === null) skipped.push({ why: 'unparsed', name });
    else if (
      p.departsOn.month === dep.getUTCMonth() + 1 &&
      p.departsOn.day === dep.getUTCDate() &&
      airportMatches(p.from, req.airportNames.origin, req.airportNames.otherOrigins) &&
      airportMatches(p.to, req.airportNames.destination, req.airportNames.otherDestinations)
    )
      mine.push({ option: p, name });
    else skipped.push({ why: 'other-cell', name });
  }
  const prices = mine.map((p) => p.option.amountMinor).sort((a, b) => a - b);
  const currency =
    f.currencyName === null ? null : (/^Currency ([A-Z]{3})$/.exec(f.currencyName)?.[1] ?? null);
  return {
    list: {
      minMinor: prices[0] ?? null,
      tabMinor: tabPriceMinor(f.cheapestTabName),
      optionsUnparsed: skipped.filter((s) => s.why === 'unparsed').length,
      optionsOtherCell: skipped.filter((s) => s.why === 'other-cell').length,
      parsedForThisCell: mine.length,
      resultsStated: f.resultsStated,
      resultsSeen: f.names.length,
      currency,
      pointOfSale: pointOfSaleOf(f.locationName),
    },
    mine,
    skipped,
  };
}

export function readList(
  f: ListFacts,
  req: Pick<ListRequest, 'departureDate' | 'airportNames'>,
  interstitials: readonly Interstitial[] = INTERSTITIALS,
): ListRead {
  return readOptions(f, req, interstitials).list;
}

/** How many skipped options one log line names; the rest are counted in `more`. */
export const SKIPPED_LOGGED_MAX = 30;

// why: page text is logged without a URL's user, password, query or fragment (CodeRabbit on PR #43), as page errors are
const clean = (text: string | null): string | null => (text === null ? null : withoutQueries(text));
const cut = (text: string | null): string | null => clean(text)?.slice(0, PAGE_ERROR_TEXT_MAX) ?? null;

/**
 * Logs at debug the options a list page did not count for its cell, and the page's stated location, when any option was
 * skipped or the location gave no point of sale (2026-11-03: a run's ten lists each found nothing for their cell and
 * stored no market, and nothing said why). A flights page also passes `rejected`, the cell's options that parsed but
 * were not a flight (`not-a-flight`, after the page's own skipped ones). Text is logged without a URL's credentials,
 * query or fragment; the location is cut to PAGE_ERROR_TEXT_MAX characters; each name is whole, already bounded by the
 * driver. The worker's own log only: an answer never carries a name.
 */
export function logSkippedOptions(
  log: Logger,
  f: ListFacts,
  req: Pick<ListRequest, 'departureDate' | 'airportNames'>,
  rejected: readonly string[] = [],
): void {
  const { list, skipped: own } = readOptions(f, req);
  const skipped: Array<{ why: SkippedOption['why'] | 'not-a-flight'; name: string | null }> = [
    ...own,
    ...rejected.map((name) => ({ why: 'not-a-flight' as const, name })),
  ];
  if (skipped.length === 0 && list.pointOfSale !== 'unknown') return;
  log.debug(
    {
      location: cut(f.locationName),
      pointOfSale: list.pointOfSale,
      // why: a name is whole (the driver already bounds it by maxNameLength): what refuses it is often near its end
      skipped: skipped.slice(0, SKIPPED_LOGGED_MAX).map((s) => ({ why: s.why, name: clean(s.name) })),
      more: Math.max(0, skipped.length - SKIPPED_LOGGED_MAX),
    },
    'options skipped',
  );
}

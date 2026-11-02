import { MINOR_EXPONENT } from '@gmt/core';

/**
 * The worker's one rule for a price the page states as a figure and a currency phrase (spec revision 56 §2: "GBP pence
 * by the ISO 4217 exponent"; the Lows deferred from WP21 Task 21.0): the currency is read from the phrase the page
 * names, never assumed, and the figure becomes minor units by that currency's exponent in core's table, never by a
 * literal hundred. A leaf (imports only core), so the option grammar (names.ts), the classifier's tab price
 * (classify.ts), the offer grammar (offers.ts) and the recorder's comparison (recordSelect.ts) share it.
 */

/**
 * The currency phrases the page's English names use, each with its ISO 4217 code. A phrase missing here reads as no
 * currency (null), so a price in it is never read as pounds.
 */
const CURRENCY_PHRASES: Readonly<Record<string, string>> = {
  'British pounds': 'GBP',
  'US dollars': 'USD',
  Euros: 'EUR',
  'Japanese yen': 'JPY',
};

/** The ISO 4217 code of a currency phrase the page states ("British pounds" → GBP), or null for one this table lacks. */
export function currencyOf(phrase: string): string | null {
  // why: an own property only, so "constructor" or "toString" is no currency
  return Object.hasOwn(CURRENCY_PHRASES, phrase) ? (CURRENCY_PHRASES[phrase] ?? null) : null;
}

/** A stated figure: digits with optional thousands commas ("1,204"), as every price grammar of the page writes it. */
const FIGURE = /^(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)$/;

/**
 * A stated figure in `code`'s minor units ("1,204", GBP → 120400; "12,000", JPY → 12000): exact digits, no float. Null
 * for a malformed figure or a code core's exponent table does not hold.
 */
export function minorOf(figure: string, code: string): number | null {
  const exponent = MINOR_EXPONENT[code];
  if (exponent === undefined || !FIGURE.test(figure)) return null;
  return Number(figure.replaceAll(',', '')) * 10 ** exponent;
}

/**
 * A figure stated in pounds (the option grammar's and the tab's fixed currency) in pence. The grammars that call it
 * have already matched the figure's shape, so a null here is a grammar bug, never a page's.
 */
export function poundsMinor(figure: string): number {
  const minor = minorOf(figure, 'GBP');
  if (minor === null) throw new Error('a pounds figure the grammar matched did not read');
  return minor;
}

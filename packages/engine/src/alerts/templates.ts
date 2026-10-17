/**
 * Plain-text alert email (spec §8.3). Core's buildDigest decides what is in a digest; this module decides the words.
 * Every provider-supplied string passes the engine's one cleaner (text.ts) before it is written.
 */
import {
  type AlertDigest,
  type AlertRule,
  type DigestItem,
  effectiveAge,
  formatAgeFull,
  formatDuration,
  formatPence,
  type IsoDateTime,
  LINK_ALLOWLIST,
  type Provenance,
  type ResultBasis,
  sourceLabel,
  validateVendorUrl,
} from '@gmt/core';
import { stripControl } from '../text.js';

/**
 * What the runner reads about one digest item from the repositories, which `DigestItem` does not carry (spec §3, §8.1;
 * decisions 30, 36, 54, 55). Keyed by the item's `rowKey` in `DigestRenderInput.marks`.
 */
export interface ItemMarks {
  /** Stale by core's isStale against the basis threshold (decisions 55, 56); null when not stale. */
  stale: { thresholdHours: number } | null;
  /** The price came from a discovery tile the page cap cut short (decision 30): "cheapest of the rows read". */
  truncated: boolean;
  /** A newer itinerary search of the cell did not see this offer; `at` is when it searched, null when unrecorded. */
  notSeenInLatest: { at: IsoDateTime | null } | null;
  /** The previous price was FX-converted: it prints with '≈' like the current one (decision 59). */
  previousConverted: boolean;
}
export const NO_MARKS: ItemMarks = {
  stale: null,
  truncated: false,
  notSeenInLatest: null,
  previousConverted: false,
};

/** Everything renderBody needs; the digest items carry segments, expiry and the row key (plan decision 14). Task 11.7 adds the marks. */
export interface DigestRenderInput {
  digest: AlertDigest;
  definitionName: string;
  appBaseUrl: string | null;
  now: IsoDateTime;
}

/** Longest provider-supplied string printed (seller, carrier, definition name): a hostile value cannot flood an email (sec-007). */
export const MAX_PROVIDER_TEXT = 200;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** A provider string for one line: cleaned (text.ts stripControl) and cut at MAX_PROVIDER_TEXT characters with "…". */
function providerText(s: string): string {
  const chars = [...stripControl(s)];
  return chars.length > MAX_PROVIDER_TEXT
    ? `${chars.slice(0, MAX_PROVIDER_TEXT - 1).join('')}…`
    : chars.join('');
}

/** "14 Mar" from a calendar date or local date-time string; never through Date (spec §6.1). */
function day(d: string): string {
  const [, m, dd] = d.slice(0, 10).split('-');
  return `${Number(dd)} ${MONTHS[Number(m) - 1] ?? m}`;
}

/** "AAA→BBB 14 Mar–28 Mar (14n)": the cell in words, without a price (the Alerts view's trip column). */
export function cellLine(cell: DigestItem['cell']): string {
  return `${cell.origin}→${cell.destination} ${day(cell.departureDate)}–${day(cell.returnDate)} (${cell.nights}n)`;
}

/** "£412 AAA→BBB 14 Mar–28 Mar (14n)", with "≈" when FX-converted (spec §11). */
export function routeLine(item: Pick<DigestItem, 'pricePence' | 'provenance' | 'cell'>): string {
  return `${item.provenance.fx.converted ? '≈' : ''}${formatPence(item.pricePence)} ${cellLine(item.cell)}`;
}

/** The age in core's full form (spec §3; decision 55 labels an unknown vendor age "vendor's cache age unknown"). */
function ageLine(p: Provenance, now: IsoDateTime): string {
  return formatAgeFull(effectiveAge(p, now));
}

function verdictSegment(item: DigestItem): string {
  if (item.verdictClass === 'unchecked') return 'constraints not checked';
  const n = item.unverified.length;
  return `${n} constraint${n === 1 ? '' : 's'} unverified`;
}

/** Spec §8.3 subject for the digest's first (cheapest) item. */
export function renderSubject(item: DigestItem, now: IsoDateTime): string {
  return stripControl(
    `[get-me-there] ${routeLine(item)} · ${sourceLabel(item.provenance)} · ${ageLine(item.provenance, now)} · ${verdictSegment(item)}`,
  );
}

/**
 * The app URL of a results row with WP9's parameters (`view`, `def`, `basis`, `row`): under APP_BASE_URL (an https
 * base with no credentials, query or fragment, which core's config enforces; a path prefix is kept), else a relative
 * path (spec §12).
 */
export function appRowLink(
  appBaseUrl: string | null,
  definitionId: string,
  basis: ResultBasis,
  rowKey: string,
): string {
  const query = new URLSearchParams({ view: 'results', def: definitionId, basis, row: rowKey }).toString();
  if (appBaseUrl === null) return `/?${query}`;
  const u = new URL(appBaseUrl);
  u.pathname = `${u.pathname.replace(/\/+$/, '')}/`;
  u.search = query;
  return u.toString();
}

/**
 * Core's labelled search link, re-validated at render like a booking link (sec-005): https on the provider's
 * LINK_ALLOWLIST and the host core stored; spec §5.3 keeps its query in email. Null only for synthetic rows.
 */
function searchLine(item: DigestItem): string {
  const link = item.searchLink;
  if (link === null) return 'Link: none';
  const checked = validateVendorUrl(link.url, LINK_ALLOWLIST[item.provenance.providerId]);
  return checked.kind === 'get' && checked.host === link.host
    ? `Link: ${checked.url} (host ${checked.host}, ${link.label})`
    : 'Link: none (the search link failed validation)';
}

/** "fetched 3d before this price", or "under an hour"; fetchGapHours is the gap between two fetches (decision 21), never an age. */
function gapText(gap: number): string {
  return gap < 1
    ? 'fetched under an hour before this price'
    : `fetched ${formatDuration(gap)} before this price`;
}

function previousLine(item: DigestItem): string | null {
  if (item.previousPricePence === null) return null;
  const gap = item.fetchGapHours === null ? '' : `, ${gapText(item.fetchGapHours)}`;
  return `   Previous: ${formatPence(item.previousPricePence)}${gap}`;
}

/** Lines specific to the item's basis; Task 11.2 adds the itinerary-search branch. */
function basisLines(_item: DigestItem): string[] {
  return ['   calendar price, no itinerary; constraints not checked'];
}

/** Task 11.2 adds the itinerary-search links. */
function linkLine(item: DigestItem, _input: DigestRenderInput): string {
  return searchLine(item);
}

function itemLines(n: number, item: DigestItem, input: DigestRenderInput): string[] {
  const lines = [
    `${n}. ${routeLine(item)}`,
    `   Why: ${stripControl(item.firingReason)}`,
    ...basisLines(item),
  ];
  const prev = previousLine(item);
  if (prev !== null) lines.push(prev);
  lines.push(`   Provenance: ${sourceLabel(item.provenance)} · ${ageLine(item.provenance, input.now)}`);
  lines.push(`   ${linkLine(item, input)}`);
  return lines;
}

function amount(pence: number | null): string {
  // why: core's evaluateAlertRules refuses a rule without its figure before anything renders; never print "£0" for it
  return pence === null ? 'an amount not set' : formatPence(pence);
}

function ruleText(r: AlertRule): string {
  const what =
    r.type === 'absolute'
      ? `alert when the price is ${amount(r.thresholdPence)} or less`
      : r.type === 'dropAbs'
        ? `alert when the price drops by ${amount(r.thresholdPence)} or more`
        : `alert when the price drops by ${r.pct === null ? 'a percentage not set' : `${r.pct}%`} or more`;
  const basis =
    r.basis === 'calendar'
      ? 'calendar basis, constraints not checked'
      : r.requireAllVerified === true
        ? 'itinerary-search basis, class verified only'
        : 'itinerary-search basis, class verified or partially-verified';
  return `${what} · ${basis} · cooldown ${r.cooldownHours}h`;
}

function coverageText(c: AlertDigest['coverageCaveat']): string {
  return c === null
    ? 'Coverage: itinerary-searched 0 cells (no verification provider configured)'
    : `Coverage: itinerary-searched ${c.itinerarySearched} of ${c.selected} cells, ${c.expandTop} outbounds each`;
}

/** One line per new item; the out-of-window previous price, when core states one, with its fetch gap (spec §6.8). */
function newItemLine(item: DigestItem, input: DigestRenderInput): string {
  const prev =
    item.previousPricePence === null
      ? ''
      : ` · previous ${formatPence(item.previousPricePence)}${item.fetchGapHours === null ? '' : `, ${gapText(item.fetchGapHours)}`}`;
  return `- ${routeLine(item)} · ${sourceLabel(item.provenance)} · ${ageLine(item.provenance, input.now)}${prev}`;
}

/** Spec §8.3 body; LF line endings only. */
export function renderBody(input: DigestRenderInput): string {
  const d = input.digest;
  const lines = [`get-me-there alert for "${providerText(input.definitionName)}"`, ''];
  d.items.forEach((item, i) => {
    lines.push(...itemLines(i + 1, item, input), '');
  });
  if (d.restCount > 0) lines.push(`and ${d.restCount} more`, '');
  if (d.newItems.length > 0) {
    lines.push('New since the last check (no earlier price within the comparison window; not a drop):');
    for (const item of d.newItems) lines.push(newItemLine(item, input));
    if (d.newRestCount > 0) lines.push(`and ${d.newRestCount} more new cells`);
    lines.push('');
  }
  lines.push(coverageText(d.coverageCaveat), `Rule: ${ruleText(d.rule)}`);
  return lines.join('\n');
}

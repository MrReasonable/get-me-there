/**
 * Plain-text alert email (spec §8.3). Core's buildDigest decides what is in a digest; this module decides the words.
 * Every provider-supplied string passes the engine's one cleaner (text.ts) before it is written.
 */
import {
  type AlertDigest,
  type AlertRule,
  CONSTRAINT_LABELS,
  type DigestItem,
  effectiveAge,
  formatAgeFull,
  formatDuration,
  formatPence,
  hoursSince,
  type IsoDateTime,
  LINK_ALLOWLIST,
  type Provenance,
  pointOfSaleLabel,
  type ResultBasis,
  type Segment,
  sourceLabel,
  TRUNCATED_NOTE,
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

/** Everything renderBody needs; the digest items carry segments, expiry and the row key (plan decision 14). */
export interface DigestRenderInput {
  digest: AlertDigest;
  definitionName: string;
  appBaseUrl: string | null;
  now: IsoDateTime;
  /** Per `DigestItem.rowKey`; an item without an entry has no marks. */
  marks: ReadonlyMap<string, ItemMarks>;
  /** Only when the pass stopped on a budget cap: the cell searches it left undone (decisions 25, 59). */
  budgetStop: { unsearched: number } | null;
  /** The itinerary-search stage never ran although a verification provider is configured (any cause). */
  verificationNotRun: boolean;
  /** Fares of this run left out of the itinerary-search basis because the final step did not confirm their price. */
  unconfirmed: number;
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
  // why: decisions 37, 44 — an unconfirmed price says so wherever it renders; the runner never alerts on one.
  if (item.unverified.includes('priceConfirmed')) return CONSTRAINT_LABELS.priceConfirmed;
  if (item.verdictClass === 'verified') return 'class verified';
  const n = item.unverified.length;
  return `${n} constraint${n === 1 ? '' : 's'} unverified`;
}

/** Spec §8.3 subject for the digest's first (cheapest) item. */
export function renderSubject(item: DigestItem, now: IsoDateTime): string {
  // why: every part is core-formatted (dates, a validated IATA code, core's labels), none provider text, so there is
  // nothing to clean here; EmailNotifier runs the one cleaner over the subject before it is sent (and tests it).
  return `[get-me-there] ${routeLine(item)} · ${sourceLabel(item.provenance)} · ${ageLine(item.provenance, now)} · ${verdictSegment(item)}`;
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

/** The previous price with '≈' when it was FX-converted (decision 59). */
function previousPrice(item: DigestItem, input: DigestRenderInput, pence: number): string {
  return `${(input.marks.get(item.rowKey) ?? NO_MARKS).previousConverted ? '≈' : ''}${formatPence(pence)}`;
}

function previousLine(item: DigestItem, input: DigestRenderInput): string | null {
  if (item.previousPricePence === null) return null;
  const gap = item.fetchGapHours === null ? '' : `, ${gapText(item.fetchGapHours)}`;
  return `   Previous: ${previousPrice(item, input, item.previousPricePence)}${gap}`;
}

function segmentLine(s: Segment): string {
  const hhmm = (local: string) => local.slice(11, 16);
  // why: sec-3 — every provider-derived field is cleaned and capped, not only the carrier
  return `${providerText(s.marketingCarrier)} ${providerText(String(s.flightNumber))} ${providerText(s.from)} ${hhmm(s.departLocal)} → ${providerText(s.to)} ${hhmm(s.arriveLocal)} (${day(s.departLocal)})`;
}

function expiryText(expiresAt: IsoDateTime | null, now: IsoDateTime): string {
  if (expiresAt === null) return 'expiry not stated';
  if (Date.parse(expiresAt) > Date.parse(now)) {
    const h = hoursSince(now, expiresAt);
    return h < 1 ? 'expires within the hour' : `expires in ${formatDuration(h)}`;
  }
  const h = hoursSince(expiresAt, now);
  return h < 1 ? 'expired just now' : `expired ${formatDuration(h)} ago`;
}

/**
 * A booking link re-validated at render (spec §5.2, decision 54): core's validateVendorUrl against the provider's
 * LINK_ALLOWLIST, and the host the adapter stored. A POST booking links to the app's results row instead (spec §8.3).
 */
function verifiedLinkLine(item: DigestItem, input: DigestRenderInput): string {
  const b = item.booking;
  if (b.kind === 'post') {
    const row = appRowLink(input.appBaseUrl, input.digest.definitionId, 'verified', item.rowKey);
    return `Link: this fare is booked through a form, which email cannot submit; open the results row in get-me-there: ${row}`;
  }
  if (b.kind === 'none') return searchLine(item);
  const checked = validateVendorUrl(b.url, LINK_ALLOWLIST[item.provenance.providerId]);
  // why: spec §5.3 (rev 10) — a validated booking link keeps its query in email; it carries no credentials.
  return checked.kind === 'get' && checked.host === b.host
    ? `Link: ${checked.url} (host ${checked.host}, ${expiryText(item.bookingExpiresAt, input.now)})`
    : 'Link: none (the stored link failed validation)';
}

/** Lines specific to the item's basis: seller, segments and verdicts for itinerary-search items; a marker for calendar prices. */
function basisLines(item: DigestItem): string[] {
  if (item.verdictClass === 'unchecked') return ['   calendar price, no itinerary; constraints not checked'];
  return [
    `   Seller: ${providerText(item.seller ?? 'not stated')}`,
    item.outbound === null
      ? '   Segments: not available'
      : `   Outbound: ${item.outbound.map(segmentLine).join('; ')}`,
    ...(item.inbound === null ? [] : [`   Inbound: ${item.inbound.map(segmentLine).join('; ')}`]),
    item.verdictClass === 'verified'
      ? '   Verdicts: class verified; every constraint passed'
      : `   Verdicts: class ${item.verdictClass}; unverified: ${item.unverified.map((k) => CONSTRAINT_LABELS[k]).join(', ')}`,
  ];
}

/** Calendar items always carry `booking: none` (core's buildDigest), so their link is the labelled search link. */
function linkLine(item: DigestItem, input: DigestRenderInput): string {
  return item.verdictClass === 'unchecked' ? searchLine(item) : verifiedLinkLine(item, input);
}

/** "3h ago", or "just now" under an hour. */
function agoText(at: IsoDateTime, now: IsoDateTime): string {
  const h = hoursSince(at, now);
  return h < 1 ? 'just now' : `${formatDuration(h)} ago`;
}

/** The marks a reader needs beside the price (spec §3, §8.1; decisions 30, 37, 44, 54, 55), in a fixed order. */
function notesOf(item: DigestItem, input: DigestRenderInput): string[] {
  const m = input.marks.get(item.rowKey) ?? NO_MARKS;
  const notes: string[] = [];
  if (item.unverified.includes('priceConfirmed')) notes.push(CONSTRAINT_LABELS.priceConfirmed);
  if (m.truncated) notes.push(TRUNCATED_NOTE);
  if (m.notSeenInLatest !== null)
    notes.push(
      m.notSeenInLatest.at === null
        ? 'not seen in latest search'
        : `not seen in latest search (${agoText(m.notSeenInLatest.at, input.now)})`,
    );
  if (m.stale !== null) notes.push(`stale: older than ${m.stale.thresholdHours}h`);
  return notes;
}

function itemLines(n: number, item: DigestItem, input: DigestRenderInput): string[] {
  const lines = [
    `${n}. ${routeLine(item)}`,
    `   Why: ${stripControl(item.firingReason)}`,
    ...basisLines(item),
  ];
  const prev = previousLine(item, input);
  if (prev !== null) lines.push(prev);
  lines.push(
    `   Provenance: ${sourceLabel(item.provenance)} · ${pointOfSaleLabel(item.provenance)} · ${ageLine(item.provenance, input.now)}`,
  );
  const notes = notesOf(item, input);
  if (notes.length > 0) lines.push(`   Notes: ${notes.join('; ')}`);
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

function coverageText(c: AlertDigest['coverageCaveat'], input: DigestRenderInput): string {
  // why: decision 59 — a cause is named only when the pass did stop on a budget cap (review PA2-1)
  if (input.verificationNotRun)
    return input.budgetStop === null
      ? 'Coverage: itinerary search not run'
      : 'Coverage: itinerary search not run (a budget cap stopped the run during discovery)';
  return c === null
    ? 'Coverage: itinerary-searched 0 cells (no verification provider configured)'
    : `Coverage: itinerary-searched ${c.itinerarySearched} of ${c.selected} cells, ${c.expandTop} outbounds each`;
}

/** One line per new item; the out-of-window previous price, when core states one, with its fetch gap (spec §6.8). */
function newItemLine(item: DigestItem, input: DigestRenderInput): string {
  const prev =
    item.previousPricePence === null
      ? ''
      : ` · previous ${previousPrice(item, input, item.previousPricePence)}${item.fetchGapHours === null ? '' : `, ${gapText(item.fetchGapHours)}`}`;
  const notes = notesOf(item, input);
  return `- ${routeLine(item)} · ${sourceLabel(item.provenance)} · ${ageLine(item.provenance, input.now)}${prev}${notes.length > 0 ? ` · ${notes.join('; ')}` : ''}`;
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
  if (input.unconfirmed > 0) {
    const n = input.unconfirmed;
    lines.push(
      `Unconfirmed: ${n} ${n === 1 ? 'fare' : 'fares'} in this run had no price confirmed by the final step; they are never alerted.`,
    );
  }
  const stop = input.budgetStop;
  if (stop !== null && stop.unsearched > 0) {
    const n = stop.unsearched;
    const count = `${input.verificationNotRun ? 'at least ' : ''}${n} cell ${n === 1 ? 'search' : 'searches'}`;
    lines.push(
      `Not searched: a budget cap left ${count} of this run undone; the prices above come from the cells that were searched.`,
    );
  } else if (stop !== null && input.verificationNotRun) {
    lines.push(
      'Not searched: a budget cap stopped this run before its itinerary search; the prices above are calendar prices only.',
    );
  }
  lines.push(coverageText(d.coverageCaveat, input), `Rule: ${ruleText(d.rule)}`);
  return lines.join('\n');
}

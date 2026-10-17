import { hoursSince } from '../labels/age.js';
import type { AlertDigest, DigestItem } from '../ports/notifier.js';
import { resultRowKey } from '../results/rowKey.js';
import { searchLinkFor } from '../results/searchLink.js';
import type { AlertRule, Firing } from '../types/alerts.js';
import type { Cell } from '../types/definition.js';
import { priceOf } from './dedup.js';

/** Spec §6.8: a digest lists the cheapest 10 firings (and 10 new cells) and counts the rest. */
const DIGEST_TOP = 10;

function cellOf(f: Firing): Cell {
  const c = f.candidate;
  if (c.basis === 'calendar') return c.cell;
  const it = c.itinerary;
  return {
    origin: it.origin,
    destination: it.destination,
    departureDate: it.departureDate,
    returnDate: it.returnDate,
    nights: it.nights,
  };
}

function item(f: Firing): DigestItem {
  const c = f.candidate;
  const { pricePence, provenance } = priceOf(c);
  const cell = cellOf(f);
  const verified = c.basis === 'verified';
  const stated = f.rule.type === 'absolute' && !f.isNew ? null : c.previous;
  return {
    pricePence,
    provenance,
    cell,
    verdictClass: verified ? c.verdictClass : 'unchecked',
    itineraryHash: verified ? c.itinerary.hash : null,
    seller: verified ? c.seller : null,
    unverified: verified ? c.unverified : [],
    // why: the previous price is shown only when the firing reason states it (a drop, or a new
    // cell whose last price was outside the window), so item and reason never disagree (review
    // pft-002, po-003). The gap is measured between the two fetches (`fetchGapHours`), the figure the rule judged.
    previousPricePence: stated === null ? null : stated.pricePence,
    fetchGapHours: stated === null ? null : hoursSince(stated.fetchedAt, provenance.fetchedAt),
    isNew: f.isNew,
    firingReason: f.reason,
    booking: verified ? c.observation.booking : { kind: 'none' },
    bookingExpiresAt: verified ? c.observation.bookingExpiresAt : null,
    outbound: verified ? c.itinerary.outbound : null,
    inbound: verified ? c.itinerary.inbound : null,
    searchLink: searchLinkFor(provenance.providerId, cell, provenance.cabin),
    rowKey: resultRowKey({
      itineraryHash: verified ? c.itinerary.hash : null,
      calendarPriceId: verified ? null : c.calendarPriceId,
    }),
  };
}

/**
 * Spec §6.8: one structured digest per rule per execution. Suppressed firings are left out.
 * `items` are the 10 cheapest firings and `restCount` the firings beyond them; `newItems` are the
 * 10 cheapest new calendar cells and `newRestCount` the new cells beyond them, kept apart so "and N
 * more" never counts cells that did not meet the rule (review po-002, pft-011). WP11 renders
 * subject and body (spec §8.3). Returns null when no unsuppressed firing exists: new cells alone
 * send nothing. Throws if any firing carries synthetic provenance (spec §5.5).
 */
export function buildDigest(
  rule: AlertRule,
  firings: Firing[],
  ctx: { executionId: string; definitionId: string; coverageCaveat: AlertDigest['coverageCaveat'] },
): AlertDigest | null {
  // why: suppressed firings are recorded by the runner but never sent (spec §6.8 cooldown).
  const own = firings.filter((f) => f.rule.id === rule.id && f.suppressed === null);
  if (own.some((f) => priceOf(f.candidate).provenance.sourceKind === 'synthetic')) {
    throw new Error('alerts refuse synthetic rows');
  }
  const cheapest = (a: Firing, b: Firing): number =>
    priceOf(a.candidate).pricePence - priceOf(b.candidate).pricePence;
  const fired = own.filter((f) => !f.isNew).sort(cheapest);
  const listed = own.filter((f) => f.isNew).sort(cheapest);
  if (fired.length === 0) return null;
  const items = fired.slice(0, DIGEST_TOP).map(item);
  const newItems = listed.slice(0, DIGEST_TOP).map(item);
  return {
    ruleId: rule.id,
    definitionId: ctx.definitionId,
    executionId: ctx.executionId,
    basis: rule.basis,
    items,
    restCount: fired.length - items.length,
    newRestCount: listed.length - newItems.length,
    newItems,
    coverageCaveat: ctx.coverageCaveat,
    rule,
  };
}

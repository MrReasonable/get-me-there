import {
  type Cabin,
  type CapabilityInfo,
  type CellKey,
  type Clock,
  cellKeyString,
  type ErrorReason,
  type FxInfo,
  type IsoDateTime,
  LINK_ALLOWLIST,
  NormalisationError,
  type NormalisedItinerary,
  normaliseOffer,
  type ObservationFields,
  type Offer,
  type PointOfSale,
  type Provenance,
  type ProviderId,
  priceInGbp,
  type RateLookup,
  type RawCalendarPrice,
  type RawOffer,
  type SuppliedField,
  stripUrlsInText,
  validateVendorUrl,
} from '@gmt/core';
import type { AirportsRepo, CalendarPriceInsert, FxRepo } from '@gmt/db';

/** The repositories and settings normalisation reads (core's own NormaliseDeps is the pure function's input). */
export interface RepoDeps {
  airports: AirportsRepo;
  fx: FxRepo;
  clock: Clock;
  fxMaxRateAgeDays: number;
}

/** The source name src/fx/refresh.ts stores with every rate; prices carry the source of the rate they used. */
export const FX_SOURCE = 'frankfurter.dev (ECB reference rates)';

/**
 * The newest ECB rate no older than FX_MAX_RATE_AGE_DAYS, in the shape core's NormaliseDeps.rateFor asks for: the one
 * FX lookup shared by calendar prices and offers (spec §5.6).
 */
export function rateFor(deps: RepoDeps, currency: string): ReturnType<RateLookup> {
  const r = deps.fx.latest(currency.toUpperCase(), deps.fxMaxRateAgeDays, deps.clock.todayLondon());
  return r === null ? null : { rateNano: r.rateNano, rateDate: r.date, source: r.source };
}

/** Why one calendar price is not stored: a normalisation reason, or `parse` for a malformed amount. */
export interface PriceRefusal {
  reason: ErrorReason;
  message: string;
}

/**
 * Spec §5.6 money for one calendar price: core's priceInGbp (the same step normaliseOffer uses) over the shared
 * rateFor, so calendar prices and offers cannot diverge (arch-r2-002). A NormalisationError is that cell's error; a
 * RangeError (an amount that is not a non-negative integer) is one malformed vendor row, so that cell's `parse` error,
 * never a fatal stop of the run.
 */
export function calendarPriceInGbp(
  deps: RepoDeps,
  amountMinor: number,
  currency: string,
): { pricePence: number; fx: FxInfo } | PriceRefusal {
  try {
    return priceInGbp({ amountMinor, currency }, (c) => rateFor(deps, c));
  } catch (err) {
    const refusal = refusalOf(err);
    if (refusal?.reason === 'fx-unavailable')
      return {
        ...refusal,
        message: `${refusal.message}: no ECB rate in the last ${deps.fxMaxRateAgeDays} days`,
      };
    if (refusal !== null) return refusal;
    throw err;
  }
}

/**
 * The one policy for a price that cannot be normalised, shared by calendar prices and offers (arch-r2-002, decision
 * 45): a NormalisationError keeps its reason; a RangeError (an amount that is not a non-negative integer, or one whose
 * conversion overflows) is `parse`, one malformed vendor row, never a fatal stop. Anything else is not a price problem
 * and is rethrown by the caller.
 */
export function refusalOf(err: unknown): PriceRefusal | null {
  if (err instanceof NormalisationError) return { reason: err.reason, message: err.message };
  if (err instanceof RangeError) return { reason: 'parse', message: stripUrlsInText(err.message) };
  return null;
}

export type ReducedTile =
  | { kind: 'ok'; perCell: Map<string, RawCalendarPrice>; discarded: number }
  | { kind: 'mixed-currency'; currencies: string[] };

/**
 * Spec §5.6: one calendar price per (provider, cell) per tile — the minimum amountMinor, ties to vendor order; discards
 * counted. amountMinor is only comparable within one currency, and a vendor answers one request in one currency
 * (spec §2), so a tile with two currencies is reported instead.
 */
export function reduceTile(prices: readonly RawCalendarPrice[]): ReducedTile {
  const currencies = [...new Set(prices.map((p) => p.currency.toUpperCase()))].sort();
  if (currencies.length > 1) return { kind: 'mixed-currency', currencies };
  const perCell = new Map<string, RawCalendarPrice>();
  let discarded = 0;
  for (const p of prices) {
    const key = cellKeyString(p);
    const kept = perCell.get(key);
    if (kept === undefined) perCell.set(key, p);
    else {
      discarded += 1;
      if (p.amountMinor < kept.amountMinor) perCell.set(key, p); // strict: an equal later price loses to the earlier one
    }
  }
  return { kind: 'ok', perCell, discarded };
}

/** A validated `https:` vendor link on the provider's allowlist (core LINK_ALLOWLIST), else null (spec §5.2). Validated links keep their query (spec rev 10). */
export function vendorLinkOf(url: string | undefined, providerId: ProviderId): string | null {
  if (url === undefined) return null;
  const b = validateVendorUrl(url, LINK_ALLOWLIST[providerId]);
  return b.kind === 'get' ? b.url : null;
}

export interface CalendarContext {
  providerId: ProviderId;
  info: CapabilityInfo;
  cabin: Cabin;
  pointOfSale: PointOfSale;
  fetchedAt: IsoDateTime;
}

/** One raw calendar price → one calendar_prices insert with full provenance, or the reason it cannot be stored. Spec §5.6, §7. */
export function normaliseCalendarPrice(
  raw: RawCalendarPrice,
  c: CalendarContext,
  deps: RepoDeps,
): CalendarPriceInsert | PriceRefusal {
  const m = calendarPriceInGbp(deps, raw.amountMinor, raw.currency);
  if ('reason' in m) return m;
  return {
    providerId: c.providerId,
    sourceKind: c.info.sourceKind,
    cabin: c.cabin,
    cell: {
      origin: raw.origin,
      destination: raw.destination,
      departureDate: raw.departureDate,
      returnDate: raw.returnDate,
    },
    pricePence: m.pricePence,
    priceNativeMinor: raw.amountMinor,
    currencyNative: raw.currency.toUpperCase(),
    fx: m.fx,
    pointOfSale: c.pointOfSale,
    fetchedAt: c.fetchedAt,
    providerObservedAt: raw.providerObservedAt ?? null,
    // why: spec §7 "max_age_hours NULL means unknown and is written explicitly"
    maxAgeHours: c.info.maxAgeHours === 'unknown' ? null : c.info.maxAgeHours,
    vendorLink: vendorLinkOf(raw.vendorLink, c.providerId),
    reusedFromExecutionId: null,
  };
}

export interface OfferContext {
  providerId: ProviderId;
  info: CapabilityInfo;
  cabin: Cabin;
  pointOfSale: PointOfSale;
  fetchedAt: IsoDateTime;
  suppliedFields: readonly SuppliedField[];
  partialExpansion: boolean;
}

export interface OfferWrite {
  itinerary: NormalisedItinerary;
  offer: Offer;
  observation: ObservationFields & {
    provenance: Provenance;
    suppliedFields: SuppliedField[];
    partialExpansion: boolean;
  };
}

/**
 * One raw offer → one observation write, or the reason it is dropped (spec §5.6). Everything is core's normaliseOffer
 * — airport zones, local times, hashing, the cell match, money with the FX flag, evidenced cabins, the validated
 * booking — fed the airports repository and the shared rateFor (one money pipeline, arch-013); only the provenance is
 * stamped here.
 */
export function offerWrite(
  raw: RawOffer,
  cell: CellKey,
  c: OfferContext,
  deps: RepoDeps,
): OfferWrite | PriceRefusal {
  let r: ReturnType<typeof normaliseOffer>;
  try {
    r = normaliseOffer(raw, cell, {
      providerId: c.providerId,
      cabin: c.cabin,
      tzOf: (iata) => deps.airports.tzOf(iata),
      rateFor: (cur) => rateFor(deps, cur),
    });
  } catch (err) {
    // why: decision 45 — core's normaliseOffer rethrows toGbp's RangeError; a malformed amount drops one offer
    const refusal = refusalOf(err);
    if (refusal === null) throw err;
    return refusal;
  }
  if (!r.ok) return { reason: r.error.reason, message: r.error.message };
  // why: decision 27 — a price no seller listing confirmed is stored as unverified: without 'price' and 'segmentCabins'
  // in its supplied fields (and no cabin evidence), so the cabin verdict and any price constraint read unverified and
  // the row is never a verified fare
  const suppliedFields = raw.verified
    ? [...c.suppliedFields]
    : c.suppliedFields.filter((f) => f !== 'price' && f !== 'segmentCabins');
  const observation = raw.verified ? r.observation : { ...r.observation, segmentCabins: null };
  const provenance: Provenance = {
    providerId: c.providerId,
    sourceKind: c.info.sourceKind,
    fetchedAt: c.fetchedAt,
    maxAgeHours: c.info.maxAgeHours,
    fx: r.observation.fx,
    pointOfSale: c.pointOfSale,
    cabin: r.offer.cabin,
  };
  return {
    itinerary: r.itinerary,
    offer: r.offer,
    observation: {
      ...observation,
      provenance,
      suppliedFields,
      partialExpansion: c.partialExpansion,
    },
  };
}

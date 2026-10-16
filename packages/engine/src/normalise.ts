import {
  type Cabin,
  type CapabilityInfo,
  type Clock,
  cellKeyString,
  type FxInfo,
  type IsoDateTime,
  LINK_ALLOWLIST,
  NormalisationError,
  type PointOfSale,
  type ProviderId,
  type RawCalendarPrice,
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

/** Spec §5.6 money for one calendar price. Task 7.1: GBP only; Task 7.5 adds ECB currencies. */
export function calendarPriceInGbp(
  _deps: RepoDeps,
  amountMinor: number,
  currency: string,
): { pricePence: number; fx: FxInfo } | NormalisationError {
  if (currency.toUpperCase() === 'GBP') return { pricePence: amountMinor, fx: { converted: false } };
  return new NormalisationError('currency-unsupported', currency.toUpperCase());
}

export type ReducedTile = { kind: 'ok'; perCell: Map<string, RawCalendarPrice>; discarded: number };

/** Spec §5.6: one calendar price per (provider, cell) per tile — the minimum amountMinor, ties to vendor order; discards counted. */
export function reduceTile(prices: readonly RawCalendarPrice[]): ReducedTile {
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
): CalendarPriceInsert | NormalisationError {
  const m = calendarPriceInGbp(deps, raw.amountMinor, raw.currency);
  if (m instanceof NormalisationError) return m;
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

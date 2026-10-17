/**
 * The fixture provider's raw-shape readers (ca-011, split from provider.ts): envelope and pair checks, dated calendar
 * entries, airports, segments and offers, each refusing a malformed body with the shared parse error.
 */
import {
  asIata,
  cabinSchema,
  type Iata,
  type IsoDate,
  type ItineraryQuery,
  isoDateSchema,
  type RawOffer,
  type RawSegment,
} from '@gmt/core';
import { type ParseWhere, parseError } from '../shared/errors.js';
import { isRecord } from '../util.js';

/** Where a fixture response came from, for the shared parse error (plan decisions 29 and 30). */
export const where = (endpointPath: string): ParseWhere => ({ providerId: 'fixture', endpointPath });

/** Envelope checks shared by every endpoint: synthetic marker, currency read from the response, pair echo. */
export function envelope(
  endpointPath: string,
  body: unknown,
  origin: string,
  destination: string,
): { b: Record<string, unknown>; currency: string } {
  if (!isRecord(body)) throw parseError('malformed-envelope', null, where(endpointPath));
  // why: spec §5.5 — the provider refuses anything not marked synthetic, so it can never carry real data.
  if (body.synthetic !== true) throw parseError('not-synthetic', null, where(endpointPath));
  const currency = body.currency;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))
    throw parseError('missing-currency', null, where(endpointPath));
  if (body.origin !== origin || body.destination !== destination)
    throw parseError('pair-mismatch', null, where(endpointPath));
  return { b: body, currency };
}

/** A dated calendar entry, its dates narrowed by core's schema so lookups go through cellKeyString (arch-r2-007). */
export function dated(
  endpointPath: string,
  e: unknown,
): { departureDate: IsoDate; returnDate: IsoDate; e: Record<string, unknown> } {
  if (!isRecord(e)) throw parseError('malformed-entry', null, where(endpointPath));
  const departureDate = isoDateSchema.safeParse(e.departureDate);
  const returnDate = isoDateSchema.safeParse(e.returnDate);
  if (!departureDate.success || !returnDate.success)
    throw parseError('malformed-entry', null, where(endpointPath));
  return { departureDate: departureDate.data, returnDate: returnDate.data, e };
}

function iata(endpointPath: string, v: unknown): Iata {
  if (typeof v !== 'string') throw parseError('malformed-segment', null, where(endpointPath));
  try {
    return asIata(v);
  } catch {
    throw parseError('malformed-segment', null, where(endpointPath));
  }
}

function segment(endpointPath: string, s: unknown): RawSegment {
  if (!isRecord(s)) throw parseError('malformed-segment', null, where(endpointPath));
  const { carrier, flightNumber, depart, arrive, cabin } = s;
  if (
    typeof carrier !== 'string' ||
    typeof flightNumber !== 'string' ||
    typeof depart !== 'string' ||
    typeof arrive !== 'string'
  )
    throw parseError('malformed-segment', null, where(endpointPath));
  const seg: RawSegment = {
    marketingCarrier: carrier,
    flightNumber,
    from: iata(endpointPath, s.from),
    to: iata(endpointPath, s.to),
    depart,
    arrive,
    timeKind: 'local',
  };
  const stated = cabinSchema.safeParse(cabin);
  if (stated.success) seg.cabin = stated.data;
  return seg;
}

function offer(endpointPath: string, o: unknown, q: ItineraryQuery, currency: string): RawOffer {
  if (!isRecord(o)) throw parseError('malformed-offer', null, where(endpointPath));
  const { seller, amountMinor, outbound, inbound } = o;
  if (
    typeof seller !== 'string' ||
    typeof amountMinor !== 'number' ||
    !Number.isInteger(amountMinor) ||
    amountMinor < 0
  )
    throw parseError('malformed-offer', null, where(endpointPath));
  if (!Array.isArray(outbound) || !Array.isArray(inbound))
    throw parseError('malformed-offer', null, where(endpointPath));
  const raw: RawOffer = {
    outbound: outbound.map((s: unknown) => segment(endpointPath, s)),
    inbound: inbound.map((s: unknown) => segment(endpointPath, s)),
    seller,
    requestedCabin: q.cabin,
    amountMinor,
    currency,
    // why: synthetic data never links anywhere (spec §5.2 vendor links; §5.5 no fabricated data).
    booking: { kind: 'none' },
    // why: under the synthetic gate these offers stand in for confirmed prices (plan decision 31), so the engine's
    // verified path is exercised; their provenance stays `synthetic` and is never a confirmation of a real fare.
    verified: true,
  };
  // why: only what the response states is passed on (prov-011); nothing is defaulted.
  if (typeof o.taxesIncluded === 'boolean') raw.taxesIncluded = o.taxesIncluded;
  if (typeof o.selfTransfer === 'boolean') raw.selfTransfer = o.selfTransfer;
  const bag = o.baggage;
  if (isRecord(bag)) {
    raw.baggage = {
      ...(bag.cabinBag === 'included' || bag.cabinBag === 'not-included' ? { cabinBag: bag.cabinBag } : {}),
      ...(typeof bag.checkedBags === 'number' ? { checkedBags: bag.checkedBags } : {}),
    };
  }
  return raw;
}

export function offersOf(
  endpointPath: string,
  b: Record<string, unknown>,
  q: ItineraryQuery,
  currency: string,
): RawOffer[] {
  const offers = b.offers;
  if (!Array.isArray(offers)) throw parseError('malformed-envelope', null, where(endpointPath));
  return offers.map((o: unknown) => offer(endpointPath, o, q, currency));
}

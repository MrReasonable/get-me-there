import type {
  Cabin,
  CellKey,
  CellOutcome,
  Clock,
  FxInfo,
  HistoryPoint,
  IsoDateTime,
  NormalisedItinerary,
  Observation,
  Offer,
  Provenance,
  ProviderId,
  ResolvedSpace,
  Segment,
} from '@gmt/core';
import type { Db } from '../client.js';
import { CABINS, PROVIDER_IDS, SOURCE_KINDS } from '../internal/enums.js';
import { CELL_WHERE, keyParams, type OutcomeDbRow, toOutcome } from '../internal/outcomeRow.js';
import { fxOf } from '../internal/priceRow.js';
import {
  oneOf,
  readBaggage,
  readBooking,
  readCabins,
  readDate,
  readFareConditions,
  readIata,
  readJson,
  readLayovers,
  readNullableTime,
  readStringArray,
  readSuppliedFields,
  readTime,
} from '../internal/read.js';
import {
  assertInt,
  assertIsoDate,
  assertIsoDateTime,
  assertNullableInt,
  assertNullableIsoDateTime,
  assertPointOfSale,
  assertPriceMoney,
  assertProviderKind,
  RowRejected,
} from '../internal/validate.js';
import type { ObservationRow, RepoOptions } from '../types.js';

interface ObservationDbRow {
  id: number;
  offer_id: number;
  execution_id: string;
  source_kind: string;
  cabin: string;
  fetched_at: string;
  provider_observed_at: string | null;
  price_pence: number;
  price_native_minor: number;
  currency_native: string;
  fx_rate_nano: number | null;
  fx_rate_date: string | null;
  fx_source: string | null;
  fx_converted: number;
  point_of_sale: string;
  max_age_hours: number | null;
  taxes_included: number | null;
  self_transfer: number | null;
  segment_cabins_json: string | null;
  baggage_json: string | null;
  fare_conditions_json: string | null;
  booking_json: string | null;
  booking_expires_at: string | null;
  supplied_fields_json: string;
  partial_expansion: number;
  itinerary_hash: string;
  provider_id: string;
  seller: string;
}
interface ItineraryDbRow {
  hash: string;
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string;
  nights: number;
  outbound_minutes: number | null;
  inbound_minutes: number | null;
  stops_out: number;
  stops_in: number;
  airport_change: number | null;
  carriers_json: string;
  layovers_json: string;
  first_seen_at: string;
}
interface SegmentDbRow {
  direction: string;
  marketing_carrier: string;
  operating_carrier: string | null;
  flight_number: number;
  from_iata: string;
  to_iata: string;
  depart_local: string;
  arrive_local: string;
  depart_utc: string | null;
  arrive_utc: string | null;
  duration_minutes: number | null;
  aircraft: string | null;
}

const O = 'price_observations';
/** Field-wise FxInfo equality (arch-r2-009): independent of key order. */
const sameFx = (a: FxInfo, b: FxInfo): boolean =>
  a.converted === b.converted &&
  (!a.converted ||
    !b.converted ||
    (a.rateNano === b.rateNano && a.rateDate === b.rateDate && a.source === b.source));
const nullableBool = (v: number | null): boolean | null => (v === null ? null : v === 1);
const boolOrNull = (v: boolean | null) => (v === null ? null : v ? 1 : 0);

function toObservation(r: ObservationDbRow): Observation {
  const fx = fxOf(O, r);
  const providerObservedAt = readNullableTime(`${O}.provider_observed_at`, r.provider_observed_at);
  const provenance: Provenance = {
    providerId: oneOf('fare_offers.provider_id', PROVIDER_IDS, r.provider_id),
    sourceKind: oneOf(`${O}.source_kind`, SOURCE_KINDS, r.source_kind),
    fetchedAt: readTime(`${O}.fetched_at`, r.fetched_at),
    ...(providerObservedAt === null ? {} : { providerObservedAt }),
    maxAgeHours: r.max_age_hours ?? 'unknown',
    fx,
    pointOfSale: r.point_of_sale,
    cabin: oneOf(`${O}.cabin`, CABINS, r.cabin),
  };
  return {
    id: r.id,
    offerId: r.offer_id,
    executionId: r.execution_id,
    provenance,
    pricePence: r.price_pence,
    priceNativeMinor: r.price_native_minor,
    currencyNative: r.currency_native,
    fx,
    taxesIncluded: nullableBool(r.taxes_included),
    selfTransfer: nullableBool(r.self_transfer),
    segmentCabins:
      r.segment_cabins_json === null
        ? null
        : readCabins(`${O}.segment_cabins_json`, readJson(`${O}.segment_cabins_json`, r.segment_cabins_json)),
    baggage:
      r.baggage_json === null
        ? null
        : readBaggage(`${O}.baggage_json`, readJson(`${O}.baggage_json`, r.baggage_json)),
    fareConditions:
      r.fare_conditions_json === null
        ? null
        : readFareConditions(
            `${O}.fare_conditions_json`,
            readJson(`${O}.fare_conditions_json`, r.fare_conditions_json),
          ),
    booking: r.booking_json === null ? { kind: 'none' } : readBooking(`${O}.booking_json`, r.booking_json),
    bookingExpiresAt: readNullableTime(`${O}.booking_expires_at`, r.booking_expires_at),
    suppliedFields: readSuppliedFields(
      `${O}.supplied_fields_json`,
      readJson(`${O}.supplied_fields_json`, r.supplied_fields_json),
    ),
    partialExpansion: r.partial_expansion === 1,
  };
}

function toSegment(s: SegmentDbRow): Segment {
  const departUtc = readNullableTime('segments.depart_utc', s.depart_utc);
  const arriveUtc = readNullableTime('segments.arrive_utc', s.arrive_utc);
  return {
    marketingCarrier: s.marketing_carrier,
    ...(s.operating_carrier === null ? {} : { operatingCarrier: s.operating_carrier }),
    flightNumber: s.flight_number,
    from: readIata('segments.from_iata', s.from_iata),
    to: readIata('segments.to_iata', s.to_iata),
    departLocal: s.depart_local,
    arriveLocal: s.arrive_local,
    ...(departUtc === null ? {} : { departUtc }),
    ...(arriveUtc === null ? {} : { arriveUtc }),
    ...(s.duration_minutes === null ? {} : { durationMinutes: s.duration_minutes }),
    ...(s.aircraft === null ? {} : { aircraft: s.aircraft }),
  };
}

const OBSERVATION_JOIN = `FROM price_observations o JOIN fare_offers f ON f.id = o.offer_id JOIN itineraries i ON i.hash = f.itinerary_hash JOIN search_executions e ON e.id = o.execution_id`;
const OBSERVATION_COLUMNS = 'o.*, f.itinerary_hash, f.provider_id, f.seller';
const RECOMPUTE_OFFER_SQL = `
UPDATE fare_offers SET
  first_seen_at = (SELECT MIN(fetched_at) FROM price_observations WHERE offer_id = @id),
  last_seen_at = (SELECT MAX(fetched_at) FROM price_observations WHERE offer_id = @id),
  first_price_pence = (SELECT price_pence FROM price_observations WHERE offer_id = @id ORDER BY fetched_at ASC, id ASC LIMIT 1),
  lowest_price_pence = (SELECT MIN(price_pence) FROM price_observations WHERE offer_id = @id),
  highest_price_pence = (SELECT MAX(price_pence) FROM price_observations WHERE offer_id = @id),
  latest_price_pence = (SELECT price_pence FROM price_observations WHERE offer_id = @id ORDER BY fetched_at DESC, id DESC LIMIT 1)
WHERE id = @id`;

/** Spec §7 itineraries, segments, fare offers and price observations. */
export class ItinerariesRepo {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly opts: RepoOptions,
  ) {}

  /** Insert-or-ignore on hash, with its segments and layovers, in one transaction (spec §7). */
  upsertItinerary(it: NormalisedItinerary): void {
    if (it.hash.length === 0) throw new RowRejected('hash', 'itinerary hash is empty');
    assertInt('nights', it.nights);
    assertInt('stops_out', it.stopsOut);
    assertInt('stops_in', it.stopsIn);
    assertNullableInt('outbound_minutes', it.outboundMinutes ?? null);
    assertNullableInt('inbound_minutes', it.inboundMinutes ?? null);
    assertIsoDate('departure_date', it.departureDate);
    assertIsoDate('return_date', it.returnDate);
    const segs = [
      ...it.outbound.map((s, position) => ({ s, direction: 'outbound', position })),
      ...it.inbound.map((s, position) => ({ s, direction: 'inbound', position })),
    ];
    for (const { s } of segs) {
      assertInt('flight_number', s.flightNumber);
      assertNullableInt('duration_minutes', s.durationMinutes ?? null);
    }
    this.db.transaction(() => {
      this.db.raw
        .prepare(
          `INSERT INTO itineraries (hash, kind, origin, destination, departure_date, return_date, nights, outbound_minutes, inbound_minutes, stops_out, stops_in, airport_change, carriers_json, layovers_json, first_seen_at)
           VALUES (@hash, 'flight', @origin, @destination, @departureDate, @returnDate, @nights, @outboundMinutes, @inboundMinutes, @stopsOut, @stopsIn, @airportChange, @carriers, @layovers, @now)
           ON CONFLICT(hash) DO NOTHING`,
        )
        .run({
          hash: it.hash,
          origin: it.origin,
          destination: it.destination,
          departureDate: it.departureDate,
          returnDate: it.returnDate,
          nights: it.nights,
          outboundMinutes: it.outboundMinutes ?? null,
          inboundMinutes: it.inboundMinutes ?? null,
          stopsOut: it.stopsOut,
          stopsIn: it.stopsIn,
          airportChange: it.airportChange === undefined ? null : it.airportChange ? 1 : 0,
          carriers: JSON.stringify(it.marketingCarriers),
          layovers: JSON.stringify(it.layovers),
          now: this.clock.now(),
        });
      const insertSegment = this.db.raw.prepare(
        `INSERT INTO segments (itinerary_hash, direction, position, mode, marketing_carrier, operating_carrier, flight_number, from_iata, to_iata, depart_local, arrive_local, depart_utc, arrive_utc, duration_minutes, aircraft)
         VALUES (@hash, @direction, @position, 'air', @marketingCarrier, @operatingCarrier, @flightNumber, @from, @to, @departLocal, @arriveLocal, @departUtc, @arriveUtc, @durationMinutes, @aircraft)
         ON CONFLICT(itinerary_hash, direction, position) DO NOTHING`,
      );
      for (const { s, direction, position } of segs) {
        insertSegment.run({
          hash: it.hash,
          direction,
          position,
          marketingCarrier: s.marketingCarrier,
          operatingCarrier: s.operatingCarrier ?? null,
          flightNumber: s.flightNumber,
          from: s.from,
          to: s.to,
          departLocal: s.departLocal,
          arriveLocal: s.arriveLocal,
          departUtc: s.departUtc ?? null,
          arriveUtc: s.arriveUtc ?? null,
          durationMinutes: s.durationMinutes ?? null,
          aircraft: s.aircraft ?? null,
        });
      }
    });
  }

  get(hash: string): (NormalisedItinerary & { firstSeenAt: IsoDateTime }) | null {
    const r = this.db.raw
      .prepare<[string], ItineraryDbRow>('SELECT * FROM itineraries WHERE hash = ?')
      .get(hash);
    if (r === undefined) return null;
    const segs = this.db.raw
      .prepare<[string], SegmentDbRow>('SELECT * FROM segments WHERE itinerary_hash = ? ORDER BY position')
      .all(hash);
    const I = 'itineraries';
    return {
      hash: r.hash,
      origin: readIata(`${I}.origin`, r.origin),
      destination: readIata(`${I}.destination`, r.destination),
      departureDate: readDate(`${I}.departure_date`, r.departure_date),
      returnDate: readDate(`${I}.return_date`, r.return_date),
      nights: r.nights,
      outbound: segs.filter((s) => s.direction === 'outbound').map(toSegment),
      inbound: segs.filter((s) => s.direction === 'inbound').map(toSegment),
      ...(r.outbound_minutes === null ? {} : { outboundMinutes: r.outbound_minutes }),
      ...(r.inbound_minutes === null ? {} : { inboundMinutes: r.inbound_minutes }),
      stopsOut: r.stops_out,
      stopsIn: r.stops_in,
      layovers: readLayovers(`${I}.layovers_json`, readJson(`${I}.layovers_json`, r.layovers_json)),
      ...(r.airport_change === null ? {} : { airportChange: r.airport_change === 1 }),
      marketingCarriers: readStringArray(
        `${I}.carriers_json`,
        readJson(`${I}.carriers_json`, r.carriers_json),
      ),
      firstSeenAt: readTime(`${I}.first_seen_at`, r.first_seen_at),
    };
  }

  /** Returns the offer id for (itinerary, provider, seller, cabin), creating it if absent. */
  upsertOffer(offer: Offer): number {
    if (offer.seller.length === 0) throw new RowRejected('seller', 'seller is required (spec §7 NOT NULL)');
    const now = this.clock.now();
    this.db.raw
      .prepare(
        `INSERT INTO fare_offers (itinerary_hash, provider_id, seller, cabin, first_seen_at, last_seen_at) VALUES (@itineraryHash, @providerId, @seller, @cabin, @now, @now) ON CONFLICT(itinerary_hash, provider_id, seller, cabin) DO NOTHING`,
      )
      .run({ ...offer, now });
    const r = this.db.raw
      .prepare<Record<string, unknown>, { id: number }>(
        'SELECT id FROM fare_offers WHERE itinerary_hash = @itineraryHash AND provider_id = @providerId AND seller = @seller AND cabin = @cabin',
      )
      .get({ ...offer });
    if (r === undefined) throw new Error('fare offer vanished after upsert');
    return r.id;
  }

  /** Appends one observation and recomputes the offer's first/lowest/highest/latest (latest = max fetched_at, tie id). */
  insertObservation(obs: Omit<Observation, 'id'>): number {
    const offer = this.db.raw
      .prepare<[number], { provider_id: string; cabin: string }>(
        'SELECT provider_id, cabin FROM fare_offers WHERE id = ?',
      )
      .get(obs.offerId);
    if (offer === undefined) throw new RowRejected('missing', `fare offer ${obs.offerId} does not exist`);
    const p = obs.provenance;
    assertProviderKind(p.providerId, p.sourceKind, this.opts.allowSynthetic);
    if (p.providerId !== offer.provider_id || p.cabin !== offer.cabin)
      throw new RowRejected(
        'offer-mismatch',
        `observation ${p.providerId}/${p.cabin} does not match offer ${offer.provider_id}/${offer.cabin}`,
      );
    if (!sameFx(p.fx, obs.fx))
      throw new RowRejected('fx-mismatch', 'observation fx and provenance fx disagree');
    assertPriceMoney(obs);
    assertIsoDateTime('fetched_at', p.fetchedAt);
    if (p.providerObservedAt !== undefined) assertIsoDateTime('provider_observed_at', p.providerObservedAt);
    assertNullableIsoDateTime('booking_expires_at', obs.bookingExpiresAt);
    if (p.maxAgeHours !== 'unknown') assertInt('max_age_hours', p.maxAgeHours);
    assertPointOfSale(p.pointOfSale);
    const fx = obs.fx;
    return this.db.transaction(() => {
      const id = Number(
        this.db.raw
          .prepare(
            `INSERT INTO price_observations (offer_id, execution_id, source_kind, cabin, fetched_at, provider_observed_at, price_pence, price_native_minor, currency_native,
              fx_rate_nano, fx_rate_date, fx_source, fx_converted, point_of_sale, max_age_hours, taxes_included, self_transfer, segment_cabins_json, baggage_json,
              fare_conditions_json, booking_json, booking_expires_at, supplied_fields_json, partial_expansion)
             VALUES (@offerId, @executionId, @sourceKind, @cabin, @fetchedAt, @providerObservedAt, @pricePence, @priceNativeMinor, @currencyNative,
              @fxRateNano, @fxRateDate, @fxSource, @fxConverted, @pointOfSale, @maxAgeHours, @taxesIncluded, @selfTransfer, @segmentCabins, @baggage,
              @fareConditions, @booking, @bookingExpiresAt, @suppliedFields, @partialExpansion)`,
          )
          .run({
            offerId: obs.offerId,
            executionId: obs.executionId,
            sourceKind: p.sourceKind,
            cabin: p.cabin,
            fetchedAt: p.fetchedAt,
            providerObservedAt: p.providerObservedAt ?? null,
            pricePence: obs.pricePence,
            priceNativeMinor: obs.priceNativeMinor,
            currencyNative: obs.currencyNative,
            fxRateNano: fx.converted ? fx.rateNano : null,
            fxRateDate: fx.converted ? fx.rateDate : null,
            fxSource: fx.converted ? fx.source : null,
            fxConverted: fx.converted ? 1 : 0,
            pointOfSale: p.pointOfSale,
            maxAgeHours: p.maxAgeHours === 'unknown' ? null : p.maxAgeHours,
            taxesIncluded: boolOrNull(obs.taxesIncluded),
            selfTransfer: boolOrNull(obs.selfTransfer),
            segmentCabins: obs.segmentCabins === null ? null : JSON.stringify(obs.segmentCabins),
            baggage: obs.baggage === null ? null : JSON.stringify(obs.baggage),
            fareConditions: obs.fareConditions === null ? null : JSON.stringify(obs.fareConditions),
            booking: JSON.stringify(obs.booking),
            bookingExpiresAt: obs.bookingExpiresAt,
            suppliedFields: JSON.stringify(obs.suppliedFields),
            partialExpansion: obs.partialExpansion ? 1 : 0,
          }).lastInsertRowid,
      );
      this.db.raw.prepare(RECOMPUTE_OFFER_SQL).run({ id: obs.offerId });
      return id;
    });
  }

  /** Observations from this definition's executions (children when asked), within the current space (null = all) and cabin. Cheapest first. */
  observationsForDefinition(
    definitionId: string,
    opts: {
      executionIds: string[] | 'all';
      space: ResolvedSpace | null;
      cabin: Cabin;
      includeChildren: boolean;
    },
  ): ObservationRow[] {
    const s = opts.space;
    return this.rows(
      `SELECT ${OBSERVATION_COLUMNS} ${OBSERVATION_JOIN}
       WHERE e.definition_id = @definitionId AND (@children = 1 OR e.is_child = 0) AND (@ids IS NULL OR o.execution_id IN (SELECT value FROM json_each(@ids))) AND f.cabin = @cabin
         AND (@spaced = 0 OR (i.origin IN (SELECT value FROM json_each(@origins)) AND i.destination IN (SELECT value FROM json_each(@destinations))
              AND i.departure_date BETWEEN @from AND @to AND i.nights BETWEEN @minNights AND @maxNights))
       ORDER BY o.price_pence, o.id`,
      {
        definitionId,
        children: opts.includeChildren ? 1 : 0,
        ids: opts.executionIds === 'all' ? null : JSON.stringify(opts.executionIds),
        cabin: opts.cabin,
        spaced: s === null ? 0 : 1,
        origins: JSON.stringify(s?.origins ?? []),
        destinations: JSON.stringify(s?.destinations ?? []),
        from: s?.departureFrom ?? '',
        to: s?.departureTo ?? '',
        minNights: s?.minNights ?? 0,
        maxNights: s?.maxNights ?? 0,
      },
    );
  }

  /** Observations this execution wrote: the verified-basis alert candidates (spec §6.8). */
  writtenBy(executionId: string): ObservationRow[] {
    return this.rows(
      `SELECT ${OBSERVATION_COLUMNS} ${OBSERVATION_JOIN} WHERE o.execution_id = @executionId ORDER BY o.id`,
      { executionId },
    );
  }

  /** The newest observation of the offer fetched strictly before `before` (spec §6.8 drop rules). */
  previousObservation(offerId: number, before: IsoDateTime): Observation | null {
    const r = this.db.raw
      .prepare<Record<string, unknown>, ObservationDbRow>(
        `SELECT ${OBSERVATION_COLUMNS} FROM price_observations o JOIN fare_offers f ON f.id = o.offer_id WHERE o.offer_id = @offerId AND o.fetched_at < @before ORDER BY o.fetched_at DESC, o.id DESC LIMIT 1`,
      )
      .get({ offerId, before });
    return r === undefined ? null : toObservation(r);
  }

  /** Every observation of every offer of one itinerary, one series per offer, oldest first (History view). */
  offerHistory(
    hash: string,
  ): Array<{ providerId: ProviderId; seller: string; cabin: Cabin; points: HistoryPoint[] }> {
    const out = new Map<
      number,
      { providerId: ProviderId; seller: string; cabin: Cabin; points: HistoryPoint[] }
    >();
    for (const r of this.db.raw
      .prepare<[string], ObservationDbRow>(
        `SELECT ${OBSERVATION_COLUMNS} FROM price_observations o JOIN fare_offers f ON f.id = o.offer_id WHERE f.itinerary_hash = ? ORDER BY f.id, o.fetched_at, o.id`,
      )
      .all(hash)) {
      const o = toObservation(r);
      const series = out.get(r.offer_id) ?? {
        providerId: o.provenance.providerId,
        seller: r.seller,
        cabin: o.provenance.cabin,
        points: [],
      };
      series.points.push({ at: o.provenance.fetchedAt, pricePence: o.pricePence, provenance: o.provenance });
      out.set(r.offer_id, series);
    }
    return [...out.values()];
  }

  /** Spec §8.1 "not seen in latest search": the newest priced|empty verification outcome for the cell in the definition's cabin (ruling 9). */
  latestVerificationOutcomeForCell(definitionId: string, cell: CellKey, cabin: Cabin): CellOutcome | null {
    const r = this.db.raw
      .prepare<Record<string, unknown>, OutcomeDbRow>(
        `SELECT o.* FROM cell_outcomes o JOIN search_executions e ON e.id = o.execution_id
         WHERE e.definition_id = @definitionId AND o.stage = 'verification' AND o.status IN ('priced', 'empty') AND o.cabin = @cabin
           AND o.origin = @origin AND o.destination = @destination AND o.departure_date = @departureDate AND o.return_date = @returnDate
         ORDER BY o.fetched_at DESC, e.created_at DESC, e.rowid DESC LIMIT 1`,
      )
      .get({ definitionId, cabin, ...cell });
    return r === undefined ? null : toOutcome(r);
  }

  /** The cell's `best_observation_id` in this execution: the cheapest observation written (ruling 13). */
  bestObservationForCell(executionId: string, cell: CellKey): number | null {
    return (
      this.db.raw
        .prepare<Record<string, unknown>, { id: number | null }>(
          `SELECT best_observation_id AS id FROM search_cells WHERE ${CELL_WHERE}`,
        )
        .get(keyParams(executionId, cell))?.id ?? null
    );
  }

  private rows(sql: string, params: Record<string, unknown>): ObservationRow[] {
    const cache = new Map<string, NormalisedItinerary>();
    return this.db.raw
      .prepare<Record<string, unknown>, ObservationDbRow>(sql)
      .all(params)
      .map((r) => {
        let it = cache.get(r.itinerary_hash);
        if (it === undefined) {
          const full = this.get(r.itinerary_hash);
          if (full === null)
            throw new Error(`observation ${r.id} points at missing itinerary ${r.itinerary_hash}`);
          const { firstSeenAt: _firstSeenAt, ...itinerary } = full;
          it = itinerary;
          cache.set(r.itinerary_hash, it);
        }
        const o = toObservation(r);
        return {
          ...o,
          offer: {
            id: r.offer_id,
            itineraryHash: r.itinerary_hash,
            providerId: o.provenance.providerId,
            seller: r.seller,
            cabin: o.provenance.cabin,
          },
          itinerary: it,
          seller: r.seller,
          cell: {
            origin: it.origin,
            destination: it.destination,
            departureDate: it.departureDate,
            returnDate: it.returnDate,
            nights: it.nights,
          },
        };
      });
  }
}

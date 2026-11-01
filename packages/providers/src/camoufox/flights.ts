/**
 * The camoufox flight-list capability (spec revision 55 §2 "The flight-list read", §5.1; WP20 Task 20.7). For one
 * cell, economy only, it asks the host-side worker for the same list page a `list` tile loads, through the worker's
 * own route `POST /v1/flights` (the key in `x-gmt-worker-key`; one ledger row of `endpoint_path` `/v1/flights`, page
 * class from the worker's contacted header), and returns what the page listed: the 30 cheapest flights in page order
 * and the page's own figures, parsed with core's one copy of the wire contract. A flight list builds no price, no
 * offer and no verdict; it never says "verified". The adapter uses the provider's one http-kit timeout (there is no
 * per-request timeout). Every non-2xx answer is a `list-error` through `classifyWorkerAnswer`, but the worker's monthly
 * cap, which is thrown as BudgetExceeded, as `fetchTile` throws it.
 */
import {
  type CapabilityInfo,
  FLIGHT_LIST_ENDPOINT_PATH,
  type FlightListCapability,
  type FlightListQuery,
  type FlightListResult,
  flightsRequestSchema,
  type ProviderContext,
  ProviderError,
  workerAnswerSchema,
} from '@gmt/core';
import { parseError } from '../shared/errors.js';
import { fetchedAtWithinRequest, postToWorker } from './post.js';
import type { CamoufoxProviderOptions } from './provider.js';

/** Spec rev 55 §2 Labels, verbatim: the flight list's provenance. */
export const CAMOUFOX_FLIGHT_LIST_INFO: CapabilityInfo = {
  sourceKind: 'scraped-self',
  maxAgeHours: 0,
  provenanceNote:
    "Google Flights flight list via Camoufox: the outbound flights Google Flights listed for this day pair, each with the lowest round-trip total Google listed with that outbound (its \"From\" price; the return flight is neither chosen nor read), when this app's own Camoufox browser read the page on the machine running this app's browser worker, from that machine's address, in the currency the page states. Times are the page's local times. Flight numbers, seller and baggage are not read; nothing is checked with the airline.",
};

const WHERE = { providerId: 'camoufox' as const, endpointPath: FLIGHT_LIST_ENDPOINT_PATH };

export function flightListCapability(o: CamoufoxProviderOptions): FlightListCapability {
  const log = o.log.child({ providerId: 'camoufox' });
  const fail = (error: ProviderError): FlightListResult => {
    log.warn({ kind: error.kind, message: error.message }, 'camoufox flight list failed');
    return { kind: 'list-error', error };
  };

  async function read(q: FlightListQuery, ctx: ProviderContext): Promise<FlightListResult> {
    // why: ruling A29: fail closed before any request: without the dataset's names the worker cannot tell this cell's
    // options apart, and the stored reason is the one word `no-airport-names`, never the parse kind's text
    if (q.airportNames.origin.length === 0 || q.airportNames.destination.length === 0)
      return fail(
        new ProviderError({
          kind: 'parse',
          retryable: false,
          reason: 'no-airport-names',
          providerId: 'camoufox',
          message: `camoufox ${FLIGHT_LIST_ENDPOINT_PATH}: the query carries no airport names [no-airport-names]`,
        }),
      );
    const request = flightsRequestSchema.safeParse({
      mode: 'flights',
      origin: q.cell.origin,
      destination: q.cell.destination,
      departureDate: q.cell.departureDate,
      returnDate: q.cell.returnDate,
      gl: o.pointOfSale,
      airportNames: q.airportNames,
    });
    // why: 20.7 review finding 5: any other request the contract refuses (a gl that is not a market, too many names,
    // not one cell) is its own parse failure, still before any request
    if (!request.success)
      return fail(
        parseError('invalid-request', 'the flight-list request is not one the worker accepts', WHERE),
      );
    const started = o.clock.now();
    const sent = await postToWorker(o, {
      path: FLIGHT_LIST_ENDPOINT_PATH,
      body: request.data,
      tileIndex: null,
      ctx,
    });
    if (!sent.ok) return fail(sent.error);
    const body = sent.body;
    const a = workerAnswerSchema.safeParse(body);
    if (!a.success || a.data.kind !== 'flights')
      return fail(parseError('unknown-answer', 'the worker answered what this build cannot read', WHERE));
    const answer = a.data;
    // why: prov-010: the page was read between this request's start and now, within the clock skew either way
    if (!fetchedAtWithinRequest(answer.fetchedAt, started, o.clock.now()))
      return fail(
        parseError('fetched-at-out-of-range', `fetchedAt ${answer.fetchedAt} is outside this request`, WHERE),
      );
    return {
      kind: 'list',
      fetchedAt: answer.fetchedAt,
      pointOfSale: answer.pointOfSale,
      listed: answer.listed,
      flights: answer.flights,
      minMinor: answer.minMinor,
      tabMinor: answer.tabMinor,
      cheapestView: answer.cheapestView,
      optionsUnparsed: answer.optionsUnparsed,
      optionsOtherCell: answer.optionsOtherCell,
      resultsStated: answer.resultsStated,
      notes: answer.notes,
    };
  }

  return { info: CAMOUFOX_FLIGHT_LIST_INFO, cabins: ['economy'], read };
}

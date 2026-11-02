/**
 * The camoufox flight-list capability (spec revision 56 §2 "The flight-list read" and "The return phase", §5.1, §5.3;
 * WP20 Task 20.7, WP21 Task 21.4). For one cell, economy only, it asks the host-side worker for the same list page a
 * `list` tile loads, through the worker's own route `POST /v1/flights` (the key in `x-gmt-worker-key`; one ledger row
 * of `endpoint_path` `/v1/flights`, page class from the worker's contacted header), and returns what the page listed:
 * the 30 cheapest flights in page order and the page's own figures, parsed with core's one copy of the wire contract.
 *
 * With the search's limits (`returnLimits`) the request also asks for the return phase, and, only then, `booking`
 * (read the shown pairing's booking options). Such a request plans `FLIGHT_LIST_PAGES_PER_PAIR_MAX` pages on its
 * reservation and carries its own timeout (`flightRequestSeconds`, 780 s with the booking read, 600 s without, at the
 * defaults); every other request plans one page under the provider's timeout. The result carries the worker's return
 * read (`returns`) and `nextLoadNotBefore`, and the capability holds http-kit's next camoufox start until then; the
 * answer's `pagesLoaded` reaches only the ledger (http-kit's `pageCountOf`). A flight list builds no price and no
 * verdict; it never says "verified". Every non-2xx answer is a `list-error` through `classifyWorkerAnswer`, but the
 * worker's monthly cap, which is thrown as BudgetExceeded, as `fetchTile` throws it.
 */
import {
  type CapabilityInfo,
  FLIGHT_LIST_ENDPOINT_PATH,
  FLIGHT_LIST_PAGES_PER_PAIR_MAX,
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

/** Spec rev 56 §2 Labels, verbatim: the flight list's provenance, the return read and the booking read included. */
export const CAMOUFOX_FLIGHT_LIST_INFO: CapabilityInfo = {
  sourceKind: 'scraped-self',
  maxAgeHours: 0,
  provenanceNote:
    "Google Flights flight list via Camoufox: the outbound flights Google Flights listed for this day pair, each with the lowest round-trip total Google listed with that outbound (its \"From\" price), and, where this app's worker selected the cheapest of the outbound flights it read that was within the search's longest journey, stops and time windows (or, when none was, the cheapest it read; or, when none of that outbound's returns was within them, the next-cheapest within them, from a fresh load of the same page), the return flights Google listed with that outbound, each with the lowest round-trip total Google listed for that outbound and that return (its \"From\" price), and, for the one return this app then selected, the booking options Google listed after its \"more booking options\" were opened: the sellers' stated prices for those two flights that this app read, of which the lowest is the pairing's price shown, the lowest seller price read for these two flights; where no outbound was selected the return flight is neither chosen nor read; when this app's own Camoufox browser read the page on the machine running this app's browser worker, from that machine's address, in the currency the page states. Times are the page's local times. Flight numbers, fare conditions and baggage are not read, no seller is visited; nothing is checked with the airline or the seller.",
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
    // why: spec rev 56 §2 "The return phase": the limits ask for the return phase (absent or null: none), and the
    // booking read is asked only with them; absent `booking` is read as false and stated so
    const limits = q.returnLimits ?? null;
    // why: read only where the limits are sent (the body and the timeout both branch on them first)
    const booking = q.booking === true;
    const request = flightsRequestSchema.safeParse({
      mode: 'flights',
      origin: q.cell.origin,
      destination: q.cell.destination,
      departureDate: q.cell.departureDate,
      returnDate: q.cell.returnDate,
      gl: o.pointOfSale,
      airportNames: q.airportNames,
      ...(limits === null ? {} : { returnLimits: limits, booking }),
    });
    // why: 20.7 review finding 5: any other request the contract refuses (a gl that is not a market, too many names,
    // not one cell) is its own parse failure, still before any request
    if (!request.success)
      return fail(
        parseError('invalid-request', 'the flight-list request is not one the worker accepts', WHERE),
      );
    const started = o.clock.now();
    // why: spec rev 56 §5.1, §5.3 (R-worst): a return phase may load the first view and the second outbound's fresh
    // load, so its reservation plans both and its timeout is the request's own (the page budget plus the read-back and
    // the round trip); a list read is one page under the provider's timeout, discovery's
    const plan =
      limits === null
        ? { pages: 1 }
        : {
            pages: FLIGHT_LIST_PAGES_PER_PAIR_MAX,
            requestTimeoutSeconds: booking
              ? o.flightRequestSeconds.booking
              : o.flightRequestSeconds.returnsOnly,
          };
    const sent = await postToWorker(o, {
      path: FLIGHT_LIST_ENDPOINT_PATH,
      body: request.data,
      tileIndex: null,
      ctx,
      ...plan,
    });
    if (!sent.ok) return fail(sent.error);
    const body = sent.body;
    const a = workerAnswerSchema.safeParse(body);
    if (!a.success || a.data.kind !== 'flights')
      return fail(parseError('unknown-answer', 'the worker answered what this build cannot read', WHERE));
    const answer = a.data;
    // why: R-spacing: the worker started the reload, so the next camoufox load waits for the spacing in this app's
    // limiter, not in a refused round trip or a spent retry; held before the fetchedAt check, since the start happened
    // whatever the page's time says
    if (answer.nextLoadNotBefore !== undefined) o.http.holdUntil('camoufox', answer.nextLoadNotBefore);
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
      // why: arch-r3-014: `pagesLoaded` is not mapped; it reached the ledger row through pageCountOf
      returns: answer.returns ?? null,
      nextLoadNotBefore: answer.nextLoadNotBefore ?? null,
    };
  }

  return { info: CAMOUFOX_FLIGHT_LIST_INFO, cabins: ['economy'], read };
}

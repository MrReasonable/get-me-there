// SYNTHETIC: a made-up flight list with its return read and booking read; no recording, carrier or seller is real.
/**
 * Spec revision 56 §6.9 (Ian's ruling 2: the second outbound; R-pick; R-sellers): the shared fixture of the pairing
 * figure, built through the contract's schemas, with its expected picks as literals. London → New York (LHR → JFK, the
 * worked example), 14 to 24 March 2027; synthetic carriers (QQ Air, QQ Atlantic) and sellers (QQ Travel, QQ Fares).
 *
 * Four outbounds; under `PAIRING_LIMITS` (25 h, at most 1 stop) the cheapest fitting one is index 2 (£498, 1 stop),
 * whose two returns both have 2 stops (over the limits), so the worker tried the next-cheapest fitting outbound, index 3
 * (£520, 1 stop), whose returns are £1,180 (1 stop) and £1,250 (direct). It booked attempt 1's return 0 and read three
 * offers after the expansion: £1,180 (QQ Travel, no fare), £1,195 (QQ Fares, "Economy Basic") and £1,210.
 */
import type { FlightLimits } from '../flights/choose.js';
import { type Offer, type ReturnRead, returnReadSchema } from '../flights/returns.js';
import { type ListedFlight, listedFlightSchema } from '../flights/types.js';

/** Every fixture module says so (spec rev 56 §0: synthetic, never a recording's). */
export const SYNTHETIC = true as const;

/** The limits the fixture was read under, and under which its expected picks hold: 25 h a leg, at most 1 stop. */
export const PAIRING_LIMITS: FlightLimits = {
  maxJourneyMinutes: 1500,
  maxStops: 1,
  departureWindowLocal: null,
  arrivalWindowLocal: null,
};

const outbound = (o: Omit<ListedFlight, 'carriers' | 'operatedBy'> & Partial<ListedFlight>): ListedFlight =>
  listedFlightSchema.parse({ carriers: ['QQ Air'], operatedBy: null, ...o });

/** The four outbounds read, in page order. */
const FLIGHTS: ListedFlight[] = [
  outbound({
    departsLocal: '08:00',
    arrivesLocal: '11:45',
    arrivesDayOffset: 0,
    durationMinutes: 465,
    stops: 0,
    amountMinor: 56_000,
  }),
  // over the journey limit (27 h)
  outbound({
    departsLocal: '06:10',
    arrivesLocal: '05:10',
    arrivesDayOffset: 1,
    durationMinutes: 1620,
    stops: 2,
    amountMinor: 48_000,
  }),
  // the pick: the cheapest within the limits
  outbound({
    departsLocal: '09:40',
    arrivesLocal: '19:25',
    arrivesDayOffset: 0,
    durationMinutes: 825,
    stops: 1,
    amountMinor: 49_800,
  }),
  // the second pick: the next-cheapest within the limits
  outbound({
    departsLocal: '07:15',
    arrivesLocal: '18:05',
    arrivesDayOffset: 0,
    durationMinutes: 890,
    stops: 1,
    carriers: ['QQ Atlantic'],
    amountMinor: 52_000,
  }),
];

const back = (o: {
  departsLocal: string;
  arrivesLocal: string;
  durationMinutes: number;
  stops: number;
  fromMinor: number;
}) => ({
  arrivesDayOffset: 1,
  carriers: ['QQ Atlantic'],
  operatedBy: null,
  ...o,
});

/** The return read: two attempts, the booking read of attempt 1's first return. */
const RETURNS: ReturnRead = returnReadSchema.parse({
  limits: PAIRING_LIMITS,
  status: 'read',
  rule: null,
  attempts: [
    {
      outboundIndex: 2,
      outboundFits: true,
      listed: 'returns',
      moreListed: true,
      returns: [
        back({
          departsLocal: '17:30',
          arrivesLocal: '09:55',
          durationMinutes: 745,
          stops: 2,
          fromMinor: 120_400,
        }),
        back({
          departsLocal: '11:05',
          arrivesLocal: '07:40',
          durationMinutes: 995,
          stops: 2,
          fromMinor: 123_000,
        }),
      ],
      optionsUnparsed: 0,
      optionsOtherCell: 0,
      resultsStated: null,
    },
    {
      outboundIndex: 3,
      outboundFits: true,
      listed: 'returns',
      moreListed: true,
      returns: [
        back({
          departsLocal: '14:20',
          arrivesLocal: '06:25',
          durationMinutes: 725,
          stops: 1,
          fromMinor: 118_000,
        }),
        back({
          departsLocal: '19:10',
          arrivesLocal: '07:15',
          durationMinutes: 485,
          stops: 0,
          fromMinor: 125_000,
        }),
      ],
      optionsUnparsed: 0,
      optionsOtherCell: 0,
      resultsStated: null,
    },
  ],
  triedAll: false,
  booking: {
    status: 'read',
    rule: null,
    attempt: 1,
    returnIndex: 0,
    expanded: true,
    moreControl: false,
    grouped: 0,
    offers: [
      { seller: 'QQ Travel', fare: null, priceMinor: 118_000 },
      { seller: 'QQ Fares', fare: 'Economy Basic', priceMinor: 119_500 },
      { seller: 'QQ Fares', fare: 'Economy Flex', priceMinor: 121_000 },
    ],
    unparsed: 0,
    nonGbp: 0,
    offersStated: null,
  },
});

/** The shared list: its outbounds and the return read the worker answered with (Tasks 21.6 and 21.7 read it). */
export const PAIRING_FIXTURE: { flights: ListedFlight[]; returns: ReturnRead } = {
  flights: FLIGHTS,
  returns: RETURNS,
};

/** `cheapestPairing(PAIRING_FIXTURE.returns, PAIRING_FIXTURE.flights, PAIRING_LIMITS)`. */
export const PAIRING_CHEAPEST = {
  attempt: 1,
  returnIndex: 0,
  fromMinor: 118_000,
  outboundFits: true,
  returnFits: true,
} as const;
/** `cheapestOffer(PAIRING_FIXTURE.returns.booking)`. */
export const PAIRING_OFFER: { index: number; offer: Offer } = {
  index: 0,
  offer: { seller: 'QQ Travel', fare: null, priceMinor: 118_000 },
};
/** `bookingReturnOf(PAIRING_FIXTURE.returns, PAIRING_FIXTURE.flights)`. */
export const PAIRING_BOOKING_RETURN = { attempt: 1, returnIndex: 0 } as const;

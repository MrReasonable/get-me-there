import { asIata, asIsoDate, asIsoDateTime } from '@gmt/core';
import { SYNTHETIC_SELLER_BOOKING } from '@gmt/core/testing';
import { createRoot } from 'react-dom/client';
import { CalendarRow } from '../src/components/rows/CalendarRow.js';
import { TripRow, TripRowHead } from '../src/components/rows/TripRow.js';
import { NowContext } from '../src/now.js';
import '../src/styles/theme.css';
import {
  airportPairIndex,
  calendarFig,
  figurePairing,
  pairingFig,
  provSearched,
  verifiedFig,
} from '../test/fixtures.dates.js';

// Test-only harness for e2e/rows.spec.ts (Trips and Search plan, Task 5): the shared rows in a real layout, bundled by
// the spec itself and never served by the app. Synthetic values in the real shapes; nothing here is a real flight.

const NOW = asIsoDateTime('2026-10-14T15:00:00.000Z');
const pair = { departureDate: asIsoDate('2026-11-11'), returnDate: asIsoDate('2026-11-28'), nights: 17 };
const search = {
  id: 'd1',
  cabin: 'economy',
  multiAirport: true,
  pointOfSale: 'GB',
  showCarriers: true,
} as const;

/** Three airlines each way, a long seller and a failed read with its reason: the longest each row can say. */
const THREE_AIRLINES = ['Virgin Atlantic', 'Aer Lingus', 'British Airways Cityflyer'];
const LONG_SELLER = 'Trip.com Travel Singapore Pte Ltd';
const trip = pairingFig({
  origin: asIata('LGW'),
  airportPair: airportPairIndex('LGW', 'JFK'),
  pairing: figurePairing({
    seller: LONG_SELLER,
    legs: {
      out: { durationMinutes: 640, stops: 2, carriers: THREE_AIRLINES },
      back: { durationMinutes: 415, stops: 1, carriers: THREE_AIRLINES },
    },
  }),
});
const verified = verifiedFig({
  price: { ...verifiedFig().price, provenance: provSearched() },
  hasBookingOptions: true,
});
const calendar = calendarFig({ pairingRead: 'list-failed', listReason: 'network' });

createRoot(document.getElementById('root') ?? document.body).render(
  <NowContext.Provider value={() => NOW}>
    <ul aria-label="Trips" data-testid="trips">
      <TripRowHead />
      <TripRow figure={trip} details={null} search={search} pair={pair} />
      <TripRow
        figure={verified}
        details={{
          departureDate: pair.departureDate,
          returnDate: pair.returnDate,
          origin: verified.origin,
          destination: verified.destination,
          legs: { out: { durationMinutes: 850, stops: 1 }, back: { durationMinutes: 725, stops: 0 } },
          booking: SYNTHETIC_SELLER_BOOKING,
        }}
        search={search}
        pair={pair}
      />
    </ul>
    <ul aria-label="Calendar" data-testid="calendar">
      <CalendarRow figure={calendar} search={search} pair={pair} onRead={() => undefined} />
    </ul>
  </NowContext.Provider>,
);

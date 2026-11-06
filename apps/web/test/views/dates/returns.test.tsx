import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  BANNED_WORD_ALLOWLIST,
  type BookingRead,
  findBannedWords,
  RETURN_STATUS,
  type ReturnRead,
} from '@gmt/core';
import { PAIRING_FIXTURE, PAIRING_LIMITS } from '@gmt/core/testing';
import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS } from '../../../src/api/queries.js';
import type { FlightList } from '../../../src/api/types.js';
import { at, type DatesOptions, priced, pricedPair, provCached } from '../../fixtures.dates.js';
import { definition } from '../../fixtures.js';
import {
  flightList,
  flightPair,
  listedFlight,
  listedReturn,
  pairingList,
  returnAttempt,
  returnRead,
} from '../../fixtures.searches.js';
import { FLIGHT_LISTS_URL, serveFlightLists } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { findBoard, renderDates } from './render.js';

// Spec rev 56 §11 "Flights" and "The pairing section" (WP21 Task 21.7): a list whose return read is `read` with returns
// shows the outbound the pairing used, its returns with their "from" prices, the cheapest seller's stated price first on
// the pairing's own "Back:" line, both legs' marks and every note that applies. Over the one shared fixture
// (`@gmt/core/testing`): London → New York, 14 → 24 Mar 2027, read 3 days before NOW (11 Oct 11:44 London), the search's
// limits the fixture's (25 h a leg, at most 1 stop). NOW is 2026-10-14T15:00Z.

/** The search whose limits the fixture was read under: 25 h a leg, at most 1 stop, no window. */
const DEF = definition({ constraints: { maxJourneyMinutes: 1_500, maxStops: 1 } });
/** One priced date pair on LHR → JFK, 14 → 24 Mar (index 0), from the Aviasales cache. */
const BOARD: DatesOptions = {
  discoveryProviders: ['travelpayouts', 'camoufox'],
  pairs: {
    [at('2027-03-14', 10)]: pricedPair(
      priced(56_400, { price: { ...priced(56_400).price, provenance: provCached() } }),
    ),
  },
};
const FIXTURE = pairingList();

/** The fixture's return read with some fields replaced (the list's own parse checks it). */
const withReturns = (over: Partial<ReturnRead>, list: Partial<FlightList> = {}): FlightList =>
  pairingList({ returns: { ...PAIRING_FIXTURE.returns, ...over }, ...list });
/** The fixture's booking read (attempt 1, return 0: three offers, QQ Travel's £1,180 the cheapest). */
const BOOKING: BookingRead = (() => {
  const b = PAIRING_FIXTURE.returns.booking;
  if (b === null) throw new Error('fixture: no booking');
  return b;
})();
/** The fixture's booking read with some fields replaced. */
const withBooking = (over: Partial<BookingRead>): FlightList =>
  withReturns({ booking: { ...BOOKING, ...over } });

/**
 * Serves `list` as the 14 → 24 Mar date pair's own list, the answer planning 2 pages a read unless `over` says;
 * `readNow` as given (final review B-I3), else the fixture's default.
 */
function serve(
  list: FlightList | null,
  over: Parameters<typeof serveFlightLists>[1] = {},
  readNow?: boolean,
) {
  server.use(
    serveFlightLists(
      (d, r) =>
        flightPair(d, r, {
          ...(d === '2027-03-14' && list !== null ? { list } : {}),
          ...(d === '2027-03-14' && readNow !== undefined ? { readNow } : {}),
        }),
      { pagesPlanned: 2, ...over },
    ),
  );
}

/** Renders the board with `list` and waits for the date pair's flights block. */
async function renderList(
  list: FlightList | null,
  o: { over?: Parameters<typeof serveFlightLists>[1]; def?: typeof DEF; readNow?: boolean } = {},
) {
  serve(list, o.over, o.readNow);
  const r = renderDates({ body: BOARD, def: o.def ?? DEF });
  await findBoard();
  await waitFor(() => expect(document.querySelector('[data-flights-for="0"]')).not.toBeNull());
  return r;
}
const block = () => {
  const b = document.querySelector<HTMLElement>('[data-flights-for="0"]');
  if (b === null) throw new Error('no flights block');
  return b;
};

/**
 * A line's words as read: each PriceCell as its amount alone, the words for assistive technology left out (they are
 * asserted on their own).
 */
function plain(el: Element): string {
  const copy = el.cloneNode(true);
  if (!(copy instanceof Element)) throw new Error('not an element');
  for (const cell of copy.querySelectorAll('[data-testid="price-cell"]'))
    cell.replaceWith(cell.querySelector('.figure')?.textContent ?? '');
  for (const sr of copy.querySelectorAll('.sr-only')) sr.remove();
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}
const lines = (testid: string) => within(block()).getAllByTestId(testid).map(plain);

afterEach(() => vi.useRealTimers());

describe('the block with a pairing (spec rev 56 §11; Review Focus 1 and 5)', () => {
  it("heads the block in one sentence with the outbound the pairing used and that the first Back price is a seller's", async () => {
    await renderList(FIXTURE);
    // why: 21.7 ui-003/004, prov-001: one sentence; each "from" price says itself what it is, so the head names only
    // the seller's price, and only when one is shown
    expect(within(block()).getByTestId('flights-head')).toHaveTextContent(
      "Outbound flights, and the return flights for the next-cheapest outbound read within your limits; the first Back price is a seller's stated price · read 3d ago, 11 Oct 11:44 · prices from Google Flights, not checked with the airline",
    );
    const section = within(block()).getByTestId('flights-pairing');
    expect(within(section).getByTestId('pairing-head')).toHaveTextContent(
      "With the next-cheapest outbound read within your limits (the cheapest one's returns were all over your limits):",
    );
  });

  it('the "Out:" line is flights[3], with its mark and no price', async () => {
    await renderList(FIXTURE);
    const out = within(block()).getByTestId('pairing-out');
    expect(plain(within(out).getByTestId('pairing-out-line'))).toBe(
      'Out: depart 07:15, arrive 18:05 · 14h 50m · 1 change · QQ Atlantic',
    );
    expect(within(out).getByTestId('pairing-out-mark')).toHaveTextContent(
      'outbound 14h 50m, within your 25h limit',
    );
    expect(within(out).queryByTestId('price-cell')).toBeNull();
  });

  it('the shown "Back:" line leads with the cheapest offer, its seller and count, through PriceCell with the list provenance', async () => {
    await renderList(FIXTURE);
    const backs = within(block()).getAllByTestId('return');
    const shown = backs[0];
    if (shown === undefined) throw new Error('no return');
    expect(plain(within(shown).getByTestId('return-line'))).toBe(
      'Back: £1,180 round trip · QQ Travel · cheapest of 3 offers read · depart 14:20, arrive 06:25 +1 · 12h 05m · 1 change · QQ Atlantic',
    );
    const cell = within(shown).getByTestId('price-cell');
    // the list's provenance through PriceCell's compact face: calendar-styled, "not checked", its age
    expect(cell.className).toMatch(/border-dashed/);
    expect(within(cell).getByTestId('face-age')).toHaveTextContent('3d old · not checked');
    expect(cell.getAttribute('title')).toContain("the browser worker's flight list");
    // the arrival's full date for assistive technology
    expect(within(shown).getByTestId('return-line')).toHaveTextContent(/arrives on .*25 March 2027/);
    expect(within(block()).getByTestId('pairing-applies')).toHaveTextContent(
      'this price is for the Out: and Back: flights shown',
    );
    expect(within(block()).getByTestId('pairing-book')).toHaveTextContent(
      'to book, search these dates on Google Flights (the link below); this app opens no seller; Google may show different flights or prices when you search',
    );
  });

  it('21.7 code M4: the price-applies and book lines follow the shown Back line, before the other returns', async () => {
    await renderList(FIXTURE);
    const [shown, other] = within(block()).getAllByTestId('return');
    if (shown === undefined || other === undefined) throw new Error('two returns');
    for (const id of ['pairing-applies', 'pairing-book']) {
      const line = within(block()).getByTestId(id);
      expect(shown.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(line.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('21.7 ui-001/002: the leading price is emphasised by its class alone; every return price sits in the inline .flight-price', async () => {
    await renderList(
      withBooking({ offers: [{ seller: 'QQ Fares', fare: 'Economy Basic', priceMinor: 119_500 }] }),
    );
    const cells = [...block().querySelectorAll('[data-testid="return-line"] [data-testid="price-cell"]')];
    expect(cells).toHaveLength(2);
    for (const c of cells) expect(c.parentElement?.closest('.flight-price')).not.toBeNull();
    expect(cells.map((c) => c.closest('.flight-price-lead') !== null)).toEqual([true, false]);
    expect(block().querySelectorAll('.flight-price-lead')).toHaveLength(1);
    for (const c of within(within(block()).getByTestId('pairing-mismatch')).getAllByTestId('price-cell'))
      expect(c.closest('.flight-price')).not.toBeNull();
  });

  it('the other returns: "from" first through PriceCell, in the chooser order, each with its marks below', async () => {
    await renderList(FIXTURE);
    expect(lines('return-line')).toEqual([
      'Back: £1,180 round trip · QQ Travel · cheapest of 3 offers read · depart 14:20, arrive 06:25 +1 · 12h 05m · 1 change · QQ Atlantic',
      'Back: from £1,250 round trip · depart 19:10, arrive 07:15 +1 · 8h 05m · direct · QQ Atlantic',
    ]);
    expect(lines('return-mark')).toEqual([
      'return 12h 05m, within your 25h limit',
      'return 8h 05m, within your 25h limit',
    ]);
  });

  it('Review Focus 5: "from" before every outbound price and every return price but the offer, never before an offer', async () => {
    await renderList(FIXTURE);
    for (const f of within(block()).getAllByTestId('flight'))
      expect(plain(f)).toMatch(/· from £[\d,]+ round trip/);
    const backs = lines('return-line');
    expect(backs[0]).toMatch(/^Back: £/);
    for (const b of backs.slice(1)) expect(b).toMatch(/^Back: from £/);
    expect(block().textContent).not.toMatch(/from\s*£1,180\s*·\s*QQ Travel/);
    expect(block()).not.toHaveTextContent(/each seller|every seller/i);
    expect(block()).not.toHaveTextContent(/verified/i);
  });

  it('marks the outbound used "selected for the returns above" and the first tried "tried first: …"', async () => {
    await renderList(FIXTURE);
    const flights = within(block()).getAllByTestId('flight');
    const markOf = (departs: string) =>
      flights
        .find((f) => plain(f).startsWith(`depart ${departs}`))
        ?.querySelector('[data-testid="flight-mark"]')?.textContent;
    expect(markOf('07:15')).toBe('selected for the returns above; outbound 14h 50m, within your 25h limit');
    expect(markOf('09:40')).toBe(
      'tried first: its returns were all over your limits; outbound 13h 45m, within your 25h limit',
    );
    expect(markOf('08:00')).toBe('outbound 7h 45m, within your 25h limit');
  });

  it('the limits line says the windows apply to the outbound, and nothing of a return not read', async () => {
    await renderList(FIXTURE);
    expect(within(block()).getByTestId('flights-limits')).toHaveTextContent(
      'airline settings not applied to flights read · windows apply to the outbound',
    );
    expect(within(block()).getByTestId('flights-limits')).not.toHaveTextContent('return leg not read');
    for (const m of within(block()).getAllByTestId('flight-mark'))
      expect(m).not.toHaveTextContent('return not read');
  });

  it('the more-listed line from the view\'s "View more" control, and the tried line when outbounds within the limits remain', async () => {
    await renderList(FIXTURE);
    expect(within(block()).getByTestId('pairing-read-note')).toHaveTextContent(
      'Google listed more return flights than this app read',
    );
    // two of the three outbounds within the limits were tried
    expect(within(block()).getByTestId('pairing-tried')).toHaveTextContent(
      '2 of the 3 outbounds within your limits were tried; other outbounds not tried',
    );
  });

  it("no seller anchor: the block's one anchor is the date pair's Google Flights link; a seller name renders as text", async () => {
    const odd = '<img src=x onerror=1>';
    await renderList(withBooking({ offers: [{ seller: odd, fare: odd, priceMinor: 118_000 }] }));
    const anchors = block().querySelectorAll('a');
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute('href')).toMatch(/^https:\/\/www\.google\.com\//);
    expect(block().querySelector('img')).toBeNull();
    expect(within(block()).getAllByTestId('return-line')[0]).toHaveTextContent(
      `${odd}, ${odd} · cheapest of 1 offer read`,
    );
  });

  it('no seller URL anywhere in the web source', () => {
    const src = resolve(import.meta.dirname, '../../../src');
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f));
    const hosts = new Set<string>();
    for (const f of files)
      for (const m of readFileSync(join(src, f), 'utf8').matchAll(/https?:\/\/([a-z0-9.-]+)/gi))
        hosts.add(m[1] ?? '');
    // why: the only absolute links the web writes are Google's search page and the repository's own docs
    for (const h of hosts) expect(['www.google.com', 'github.com', 'localhost'], h).toContain(h);
  });

  it('a fare-named offer reads "QQ Fares, Economy Basic"; a return carrier of markup renders as text', async () => {
    const odd = '<img src=x onerror=1>';
    const list = withReturns({
      attempts: [
        PAIRING_FIXTURE.returns.attempts[0] ?? returnAttempt(),
        returnAttempt({
          outboundIndex: 3,
          moreListed: true,
          returns: [
            listedReturn({ carriers: [odd] }),
            listedReturn({ departsLocal: '19:10', fromMinor: 125_000 }),
          ],
        }),
      ],
      booking: { ...BOOKING, offers: [{ seller: 'QQ Fares', fare: 'Economy Basic', priceMinor: 118_000 }] },
    });
    await renderList(list);
    const shown = lines('return-line')[0];
    expect(shown).toContain('QQ Fares, Economy Basic · cheapest of 1 offer read');
    expect(shown).toMatch(/· <img src=x onerror=1>$/);
    expect(block().querySelector('img')).toBeNull();
  });
});

// Final review B-I1: the block emphasises the shown seller's price as the answer exactly when the board leads with it
// (core's pairingLeads: within the limits, fresh, read under today's limits, complete offers), never in another state.
describe('the lead emphasis follows the one leading rule (final review B-I1)', () => {
  const leads = () => block().querySelectorAll('.flight-price-lead').length;
  it("fresh, under today's limits, complete: the shown seller's price leads", async () => {
    await renderList(FIXTURE);
    expect(leads()).toBe(1);
  });
  // why: spec rev 62 (Ian, 2026-11-06): an older pairing still leads the board, so the block emphasises it as the board's
  // answer; its price carries the list's stale mark
  it('a list older than the refresh: still the lead emphasis, the price marked older', async () => {
    await renderList(pairingList({ stale: 'refresh' }));
    expect(lines('return-line')[0]).toMatch(/^Back: £1,180/);
    expect(lines('return-line')[0]).toContain('QQ Travel · cheapest of 3 offers read');
    expect(leads()).toBe(1);
    expect(within(block()).getByTestId('flights-head')).toHaveTextContent(
      /older than this search's refresh$/,
    );
  });
  it('a list read under other limits: no lead emphasis', async () => {
    await renderList(FIXTURE, {
      def: definition({ constraints: { maxJourneyMinutes: 1_600, maxStops: 1 } }),
    });
    expect(within(block()).getByTestId('pairing-limits-changed')).toBeInTheDocument();
    expect(leads()).toBe(0);
  });
  it('offers that may be incomplete: no lead emphasis', async () => {
    await renderList(
      withBooking({
        status: 'expand-failed',
        rule: 'more-options',
        expanded: false,
        offers: [{ seller: 'QQ Fares', fare: null, priceMinor: 119_500 }],
      }),
    );
    expect(within(block()).getAllByTestId('return-line')[0]).toHaveTextContent(
      'a cheaper seller may not have been read',
    );
    expect(leads()).toBe(0);
  });
});

describe("the pairing section's notes (spec rev 56 §11)", () => {
  it('the mismatch line names both figures through PriceCell when the cheapest offer differs from the "from" price', async () => {
    await renderList(
      withBooking({ offers: [{ seller: 'QQ Fares', fare: 'Economy Basic', priceMinor: 119_500 }] }),
    );
    const line = within(block()).getByTestId('pairing-mismatch');
    expect(plain(line)).toBe("the cheapest offer read is £1,195; Google's list showed from £1,180");
    expect(within(line).getAllByTestId('price-cell')).toHaveLength(2);
  });

  it('no mismatch line when they agree', async () => {
    await renderList(FIXTURE);
    expect(within(block()).queryByTestId('pairing-mismatch')).toBeNull();
  });

  it('an incomplete booking: "a cheaper seller may not have been read" on the line of the price it qualifies', async () => {
    await renderList(
      withBooking({
        moreControl: true,
        offers: [{ seller: 'QQ Fares', fare: 'Economy Basic', priceMinor: 119_500 }],
      }),
    );
    // why: 21.7 prov-006 (L): beside the price, as the board puts it
    expect(lines('return-line')[0]).toBe(
      'Back: £1,195 round trip · QQ Fares, Economy Basic · cheapest of 1 offer read · a cheaper seller may not have been read · depart 14:20, arrive 06:25 +1 · 12h 05m · 1 change · QQ Atlantic',
    );
    expect(within(block()).queryByTestId('pairing-incomplete')).toBeNull();
  });

  it('sellers not read (an expansion that failed before any offer): "Back: from £1,180 · sellers not read" with its note', async () => {
    await renderList(
      withBooking({ status: 'expand-failed', rule: 'more-options', expanded: false, offers: [] }),
      { readNow: true },
    );
    expect(lines('return-line')[0]).toBe(
      'Back: from £1,180 round trip · sellers not read · depart 14:20, arrive 06:25 +1 · 12h 05m · 1 change · QQ Atlantic',
    );
    // why: 21.7 prov-014: one note, a sellers read that failed before any offer: never "sellers read before …"; final
    // review B-I3: "or press …" only beside the button it names
    expect(within(block()).getByTestId('pairing-booking-note')).toHaveTextContent(
      'sellers not read: tried again at the next search while among its 10 cheapest date pairs, or press Read flights for this date now',
    );
    expect(within(block()).getByRole('button', { name: /^Read flights for this date/ })).toBeInTheDocument();
    expect(within(block()).queryByTestId('pairing-applies')).toBeNull();
    // why: 21.7 prov-001: no seller's price is shown, so the head names none
    expect(within(block()).getByTestId('flights-head')).not.toHaveTextContent(/seller/);
    // why: 21.7 re-review N2: a "from" price is a weaker claim than a seller's stated one: no lead emphasis
    expect(block().querySelectorAll('.flight-price-lead')).toHaveLength(0);
  });

  it('an expansion that failed after some offers keeps its note and its offer', async () => {
    await renderList(withBooking({ status: 'expand-failed', rule: 'more-options', expanded: false }));
    expect(within(block()).getByTestId('pairing-booking-note')).toHaveTextContent(
      'sellers read before the list could be expanded; the cheapest may be missing',
    );
    expect(lines('return-line')[0]).toMatch(/^Back: £1,180 round trip · QQ Travel/);
  });

  it('the more-listed line with a count; the counts clause', async () => {
    const list = flightList({
      flights: PAIRING_FIXTURE.flights,
      returns: returnRead({
        attempts: [
          returnAttempt({
            outboundIndex: 2,
            moreListed: true,
            resultsStated: 12,
            optionsUnparsed: 2,
            optionsOtherCell: 1,
          }),
        ],
      }),
    });
    await renderList(list);
    expect(within(block()).getByTestId('pairing-read-note')).toHaveTextContent(
      '2 return options unread, 1 for other airports or days · Google listed 12 return flights; this app read the first 4',
    );
  });

  it('a one-attempt read with triedAll false: "1 of the 5 outbounds within your limits were tried; other outbounds not tried"', async () => {
    const five = [0, 1, 2, 3, 4].map((i) =>
      listedFlight({ departsLocal: `0${i + 5}:00`, amountMinor: 50_000 + i * 1_000 }),
    );
    const list = flightList({
      flights: five,
      returns: returnRead({ attempts: [returnAttempt({ outboundIndex: 0 })], triedAll: false }),
    });
    await renderList(list);
    expect(within(block()).getByTestId('pairing-head')).toHaveTextContent(
      'With the cheapest outbound read within your limits:',
    );
    expect(within(block()).getByTestId('pairing-tried')).toHaveTextContent(
      '1 of the 5 outbounds within your limits were tried; other outbounds not tried',
    );
  });

  it('no outbound within the limits: the block, the section and the line say so', async () => {
    const limits = { ...PAIRING_LIMITS, maxJourneyMinutes: 400 };
    const list = flightList({
      flights: PAIRING_FIXTURE.flights,
      returns: returnRead({
        limits,
        attempts: [returnAttempt({ outboundIndex: 1, outboundFits: false })],
      }),
    });
    await renderList(list, { def: definition({ constraints: { maxJourneyMinutes: 400, maxStops: 1 } }) });
    expect(within(block()).getByTestId('flights-head')).toHaveTextContent(
      'Outbound flights, and the return flights for the cheapest outbound read, which is over your limits · read 4h ago',
    );
    // why: 21.7 prov-001: no booking read here, so no seller's price is shown and the head names none
    expect(within(block()).getByTestId('flights-head')).not.toHaveTextContent('seller');
    expect(within(block()).getByTestId('pairing-head')).toHaveTextContent(
      'With the cheapest outbound read (over your limits):',
    );
    expect(within(block()).getByTestId('pairing-no-outbound-fits')).toHaveTextContent(
      "none of the 4 outbound flights read is within your limits; the cheapest one's returns are shown",
    );
    // a return outside every limit set is marked
    expect(lines('return-mark')[0]).toBe('return 12h 05m: over your 6h 40m limit');
  });

  it('a read whose attempts listed none: WP20\'s head and "Google listed return flights, none this app could read …"', async () => {
    const none = returnAttempt({ outboundIndex: 2, listed: 'none-for-cell', returns: [] });
    await renderList(withReturns({ attempts: [none], booking: null }));
    expect(within(block()).getByTestId('flights-head')).toHaveTextContent(/^Outbound flights only · /);
    expect(within(block()).getByTestId('flights-returns-none')).toHaveTextContent(
      'Google listed return flights, none this app could read for these airports and dates',
    );
    expect(within(block()).queryByTestId('flights-pairing')).toBeNull();
  });

  it('after a limit edit: "With the … outbound read, selected under your limits when read, 3d ago:" and that they changed', async () => {
    await renderList(FIXTURE, {
      def: definition({ constraints: { maxJourneyMinutes: 1_500, maxStops: 0 } }),
    });
    expect(within(block()).getByTestId('pairing-head')).toHaveTextContent(
      'With the next-cheapest outbound read, selected under your limits when read, 3d ago:',
    );
    expect(within(block()).getByTestId('pairing-limits-changed')).toHaveTextContent(
      'your limits have changed since these return flights were read; they are read again at the next search',
    );
    // why: 21.7 code I2 / prov-005: the block head follows the section head, never claiming today's limits
    const head = within(block()).getByTestId('flights-head');
    expect(head).toHaveTextContent(
      "Outbound flights, and the return flights for the next-cheapest outbound read, selected under your limits when read, 3d ago, 11 Oct 11:44; the first Back price is a seller's stated price · prices from Google Flights, not checked with the airline",
    );
    expect(head).not.toHaveTextContent('within your limits');
  });

  it('21.7 code M13: after a limit edit of a read where no outbound fitted, the heads say it was over the limits when read', async () => {
    const limits = { ...PAIRING_LIMITS, maxJourneyMinutes: 400 };
    const list = pairingList({
      returns: returnRead({
        limits,
        attempts: [returnAttempt({ outboundIndex: 1, outboundFits: false })],
      }),
    });
    await renderList(list, { def: definition({ constraints: { maxJourneyMinutes: 450, maxStops: 1 } }) });
    expect(within(block()).getByTestId('pairing-head')).toHaveTextContent(
      'With the cheapest outbound read, over your limits when read, 3d ago:',
    );
    expect(within(block()).getByTestId('flights-head')).toHaveTextContent(
      'Outbound flights, and the return flights for the cheapest outbound read, which was over your limits when read, 3d ago',
    );
    // why: prov-005: "none … is within your limits" is today's claim; the when-read head says it instead
    expect(within(block()).queryByTestId('pairing-no-outbound-fits')).toBeNull();
  });

  it("21.7 code I3: no return of the selected outbound fits: the section says so, the seller's price kept with its over-limit mark", async () => {
    const first = PAIRING_FIXTURE.returns.attempts[0];
    if (first === undefined) throw new Error('fixture');
    await renderList(
      withReturns({
        attempts: [first],
        triedAll: true,
        booking: {
          ...BOOKING,
          attempt: 0,
          returnIndex: 0,
          offers: [{ seller: 'QQ Travel', fare: null, priceMinor: 121_000 }],
        },
      }),
    );
    expect(within(block()).getByTestId('pairing-head')).toHaveTextContent(
      'No return flight within your limits for this outbound; the cheapest pairing read is shown, over your limits:',
    );
    expect(lines('return-line')[0]).toMatch(
      /^Back: £1,210 round trip · QQ Travel · cheapest of 1 offer read · depart 17:30/,
    );
    expect(lines('return-mark')[0]).toBe('return 2 changes: over your 1-change limit');
    // why: 21.7 re-review N3: the block head says no return fits, beside the outbound that does
    expect(within(block()).getByTestId('flights-head')).toHaveTextContent(
      'the return flights for the cheapest outbound read within your limits (none of its return flights is within your limits)',
    );
    // why: 21.7 re-review N2: an over-limit pairing's price is not the lead claim, so it carries no lead emphasis
    expect(block().querySelectorAll('.flight-price-lead')).toHaveLength(0);
  });

  // why: final review B-I2: with no return within the limits on either outbound, the block shows the pairing whose
  // sellers were read (the last attempt's, which the worker booked) with its offer, over the limits, never leading, and
  // marks the first outbound tried
  it('two attempts, no return fitting on either: the booked pairing with its offer, the first outbound marked tried', async () => {
    const [first, second] = PAIRING_FIXTURE.returns.attempts;
    const r0 = second?.returns[0];
    if (first === undefined || second === undefined || r0 === undefined) throw new Error('fixture');
    const over = (fromMinor: number, departsLocal: string) => ({ ...r0, departsLocal, stops: 2, fromMinor });
    await renderList(
      withReturns({
        attempts: [first, { ...second, returns: [over(130_000, '12:00'), over(126_000, '15:30')] }],
        booking: {
          ...BOOKING,
          attempt: 1,
          returnIndex: 1,
          offers: [{ seller: 'QQ Travel', fare: null, priceMinor: 127_000 }],
        },
      }),
    );
    expect(lines('return-line')[0]).toMatch(
      /^Back: £1,270 round trip · QQ Travel · cheapest of 1 offer read · depart 15:30/,
    );
    expect(within(block()).getByTestId('pairing-head')).toHaveTextContent(
      'No return flight within your limits for this outbound; the cheapest pairing read is shown, over your limits:',
    );
    const flights = within(block()).getAllByTestId('flight');
    const markOf = (departs: string) =>
      flights
        .find((f) => plain(f).startsWith(`depart ${departs}`))
        ?.querySelector('[data-testid="flight-mark"]')?.textContent;
    expect(markOf('07:15')).toMatch(/^selected for the returns above;/);
    expect(markOf('09:40')).toMatch(/^tried first: its returns were all over your limits;/);
    expect(block().querySelectorAll('.flight-price-lead')).toHaveLength(0);
  });

  it("21.7 code M1 / prov-010: the read clauses are the shown pairing's attempt's, not the last attempt's", async () => {
    // why: both attempts over the stops limit they were read under (so a second was made); under today's 2 changes
    // attempt 0's returns fit and are the cheapest, and its view stated 12 returns (final review B-I2: with none fitting
    // the last attempt's is shown, so the two differ only after a limit edit)
    const over = (fromMinor: number) => listedReturn({ stops: 2, fromMinor });
    await renderList(
      flightList({
        flights: PAIRING_FIXTURE.flights,
        returns: returnRead({
          attempts: [
            returnAttempt({ outboundIndex: 2, resultsStated: 12, returns: [over(100_000), over(101_000)] }),
            returnAttempt({ outboundIndex: 3, returns: [over(140_000)] }),
          ],
        }),
      }),
      { def: definition({ constraints: { maxJourneyMinutes: 1_500, maxStops: 2 } }) },
    );
    expect(within(block()).getByTestId('pairing-read-note')).toHaveTextContent(
      'Google listed 12 return flights; this app read the first 2',
    );
    expect(lines('return-line')[0]).toMatch(/^Back: from £1,000 round trip/);
  });

  it('21.7 prov-011: after a limit edit the tried line names the limits of the read only', async () => {
    // why: read under at most 1 change, when 3 of the 5 outbounds fitted; today's 2 changes would admit all 5
    const five = [0, 1, 2, 3, 4].map((i) =>
      listedFlight({ departsLocal: `0${i + 5}:00`, amountMinor: 50_000 + i * 1_000, stops: i < 2 ? 2 : 1 }),
    );
    const list = flightList({
      flights: five,
      returns: returnRead({ attempts: [returnAttempt({ outboundIndex: 2 })], triedAll: false }),
    });
    await renderList(list, { def: definition({ constraints: { maxJourneyMinutes: 1_500, maxStops: 2 } }) });
    expect(within(block()).getByTestId('pairing-tried')).toHaveTextContent(
      '1 of the 3 outbounds within your limits when read were tried; other outbounds not tried',
    );
  });

  it('after a limit edit of a one-attempt read: "With the cheapest outbound read, selected under your limits when read, 3d ago:"', async () => {
    const list = pairingList({
      returns: returnRead({ attempts: [returnAttempt({ outboundIndex: 2 })] }),
    });
    await renderList(list, { def: definition({ constraints: { maxJourneyMinutes: 1_500, maxStops: 2 } }) });
    expect(within(block()).getByTestId('pairing-head')).toHaveTextContent(
      'With the cheapest outbound read, selected under your limits when read, 3d ago:',
    );
  });

  it("a stale list's pairing carries the stale mark", async () => {
    await renderList(pairingList({ stale: 'refresh' }));
    const shown = within(block()).getAllByTestId('return')[0];
    if (shown === undefined) throw new Error('no return');
    expect(within(shown).getByTestId('price-cell')).toHaveTextContent("older than this search's refresh");
  });

  it('a return arriving the day before its date reads "−1" with its full date for assistive technology', async () => {
    const list = flightList({
      flights: PAIRING_FIXTURE.flights,
      returns: returnRead({
        attempts: [
          returnAttempt({
            outboundIndex: 2,
            returns: [listedReturn({ arrivesDayOffset: -1, arrivesLocal: '23:50' })],
          }),
        ],
      }),
    });
    await renderList(list);
    const line = within(block()).getAllByTestId('return-line')[0];
    expect(line).toHaveTextContent('arrive 23:50 −1');
    expect(line).toHaveTextContent(/arrives on .*23 March 2027/);
  });
});

describe('the toggles (spec rev 56 §11: buttons with aria-expanded, focus kept on the pressed one)', () => {
  /** Five returns on one attempt: three shown, two more, one of them over the stops limit. */
  const five = () =>
    flightList({
      flights: PAIRING_FIXTURE.flights,
      returns: returnRead({
        attempts: [
          returnAttempt({
            outboundIndex: 2,
            returns: [
              listedReturn({ fromMinor: 130_000 }),
              listedReturn({ departsLocal: '06:00', fromMinor: 100_000, stops: 2 }),
              listedReturn({ fromMinor: 118_000 }),
              listedReturn({ fromMinor: 121_000, durationMinutes: 400, stops: 0 }),
              listedReturn({ fromMinor: 125_000 }),
            ],
          }),
        ],
      }),
    });

  it('"show all return flights" lists every return in the chooser order; keyboard operable; focus stays', async () => {
    const { user } = await renderList(five());
    expect(within(block()).getByTestId('pairing-more')).toHaveTextContent(
      '2 more returns read, 1 outside your limits · show all return flights',
    );
    const toggle = within(block()).getByRole('button', { name: 'show all return flights' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // why: 21.7 ui-007: the toggle sits directly under the returns list it controls, which is named
    const list = within(block()).getByRole('list', { name: 'return flights for the selected outbound' });
    expect(toggle).toHaveAttribute('aria-controls', list.id);
    expect(list.nextElementSibling).toBe(within(block()).getByTestId('pairing-more'));
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // why: 21.7 code M2 / ui-007: one fixed name; aria-expanded alone carries the state, and the count is announced
    expect(toggle).toHaveAccessibleName('show all return flights');
    expect(within(block()).getByTestId('pairing-returns-status')).toHaveTextContent(
      'all 5 return flights shown',
    );
    expect(document.activeElement).toBe(toggle);
    expect(lines('return-line').map((l) => l.match(/£[\d,]+/)?.[0])).toEqual([
      '£1,180',
      '£1,210',
      '£1,250',
      '£1,000',
      '£1,300',
    ]);
    expect(lines('return-mark')[3]).toBe('return 2 changes: over your 1-change limit');
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(block()).getAllByTestId('return')).toHaveLength(3);
  });

  it('"show all outbound flights" beside the pairing; focus stays on it', async () => {
    const { user } = await renderList(FIXTURE);
    const toggle = within(block()).getByRole('button', { name: 'show all outbound flights' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const outbound = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(outbound).toBe(within(block()).getAllByTestId('flight')[0]?.parentElement);
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName('show all outbound flights');
    expect(document.activeElement).toBe(toggle);
    expect(within(block()).getAllByTestId('flight')).toHaveLength(4);
  });
});

describe('a list with no return read, or one that did not finish (spec rev 56 §11 "Status notes")', () => {
  const NOTES: Record<Exclude<ReturnRead['status'], 'read'>, string | null> = {
    'no-outbound': null,
    skipped: 'return flights not read: fewer than 2 browser pages left this month',
    'select-failed':
      'return flights not read: tried again at the next search while among its 10 cheapest date pairs, or press Read flights for this date now',
    'not-settled':
      'return flights not read: tried again at the next search while among its 10 cheapest date pairs, or press Read flights for this date now',
    unrecognised:
      'return flights not read: tried again at the next search while among its 10 cheapest date pairs, or press Read flights for this date now',
    'not-verified':
      'return flights are not yet read on this kind of machine; see the recording session in docs/setup.md',
  };
  const RULE: Record<Exclude<ReturnRead['status'], 'read'>, string | null> = {
    'no-outbound': null,
    skipped: 'monthly-headroom',
    'select-failed': 'select-outbound:not-found',
    'not-settled': 'returns:not-settled',
    unrecognised: 'returns:shape',
    'not-verified': null,
  };
  for (const status of RETURN_STATUS.filter((s) => s !== 'read'))
    it(`${status}: WP20's head, which never mentions return flights, and its note`, async () => {
      // why: final review B-I3: a list the read would take again (readNow), as a transient one at streak 1 is
      await renderList(withReturns({ status, rule: RULE[status], attempts: [], booking: null }), {
        readNow: status !== 'no-outbound' && status !== 'skipped',
      });
      const head = within(block()).getByTestId('flights-head');
      expect(head).toHaveTextContent(/^Outbound flights only · /);
      expect(head).not.toHaveTextContent(/return/i);
      const note = NOTES[status];
      if (note === null) expect(within(block()).queryByTestId('flights-return-note')).toBeNull();
      else {
        expect(within(block()).getByTestId('flights-return-note')).toHaveTextContent(note);
        // why: 21.7 ui-006: the note sits directly under the head it explains
        expect(head.nextElementSibling).toBe(within(block()).getByTestId('flights-return-note'));
      }
      expect(within(block()).getByTestId('flights-limits')).toHaveTextContent(
        'return leg not read; airline settings not applied to flights read',
      );
      expect(within(block()).queryByTestId('flights-pairing')).toBeNull();
    });

  // why: final review B-I3: the note words what will happen: tried again while a read would go (the button beside it),
  // else after the refresh (two transient ends in a row: R-retry), and never names a button that is not shown
  it('a transient end the read would not take again: "read again once older than this search\'s refresh", no button', async () => {
    await renderList(
      withReturns({ status: 'not-settled', rule: 'returns:not-settled', attempts: [], booking: null }),
      { readNow: false },
    );
    expect(within(block()).getByTestId('flights-return-note')).toHaveTextContent(
      "return flights not read: read again once the read is nearly as old as this search's refresh",
    );
    expect(within(block()).queryByRole('button', { name: /^Read flights/ })).toBeNull();
  });
  it('a read list whose booking read ended transient offers the read when readNow, and its note names the button', async () => {
    await renderList(withBooking({ status: 'not-settled', rule: 'select-return:not-settled', offers: [] }), {
      readNow: true,
    });
    expect(within(block()).getByTestId('pairing-booking-note')).toHaveTextContent(
      'sellers not read: tried again at the next search while among its 10 cheapest date pairs, or press Read flights for this date now',
    );
    expect(within(block()).getByRole('button', { name: /^Read flights for this date/ })).toBeInTheDocument();
  });
  it('the same booking end the read would not take again: "read again once older …", no button', async () => {
    await renderList(withBooking({ status: 'not-settled', rule: 'select-return:not-settled', offers: [] }), {
      readNow: false,
    });
    expect(within(block()).getByTestId('pairing-booking-note')).toHaveTextContent(
      "sellers not read: read again once the read is nearly as old as this search's refresh",
    );
    expect(within(block()).queryByRole('button', { name: /^Read flights/ })).toBeNull();
  });

  it('returns: null renders WP20\'s block: its head, "; return not read" on a mark, no pairing, no note', async () => {
    await renderList(flightList({ flights: PAIRING_FIXTURE.flights, minMinor: 48_000 }));
    expect(within(block()).getByTestId('flights-head')).toHaveTextContent(
      'Outbound flights only · each price is the lowest round trip listed with it · read 4h ago · prices from Google Flights, not checked with the airline',
    );
    expect(within(block()).queryByTestId('flights-pairing')).toBeNull();
    expect(within(block()).queryByTestId('flights-return-note')).toBeNull();
    expect(within(block()).getAllByTestId('flight-mark')[0]).toHaveTextContent('; return not read');
    expect(within(block()).getByTestId('flights-limits')).toHaveTextContent(
      'return leg not read; airline settings not applied to flights read',
    );
    expect(within(block()).getByRole('button', { name: 'show all' })).toBeInTheDocument();
    expect(within(block()).queryByRole('button', { name: /^Read flights/ })).toBeNull();
    // why: 21.7 code M6: a list read without a return phase shows as the outbound list, with no note of its own
    expect(block()).not.toHaveTextContent('return flights not read with this list');
  });
});

describe('the read button and the live region (spec rev 56 §11; rulings D3, prov-008, R-low-pages)', () => {
  it('"Read flights for this date (free, up to 2 pages)", the pages from the response\'s pagesPlanned', async () => {
    await renderList(null);
    expect(
      within(block()).getByRole('button', { name: 'Read flights for this date (free, up to 2 pages)' }),
    ).toBeEnabled();
  });

  it('"free, 1 page" when the response plans one', async () => {
    await renderList(null, { over: { pagesPlanned: 1 } });
    expect(
      within(block()).getByRole('button', { name: 'Read flights for this date (free, 1 page)' }),
    ).toBeEnabled();
  });

  it('with 1 page left this month: an outbound-only read, never a refusal', async () => {
    await renderList(null, { over: { monthlyPagesLeft: 1 } });
    expect(
      within(block()).getByRole('button', {
        name: 'Read flights for this date (free, 1 page; return leg not read: fewer than 2 pages left)',
      }),
    ).toBeEnabled();
  });

  it('a pressed read that lands with returns says "Flights read for 14 → 24 Mar, 2 return flights"; focus stays in the block', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'], shouldAdvanceTime: false });
    let pressed = false;
    let landed = false;
    server.use(
      http.post(FLIGHT_LISTS_URL, () => {
        pressed = true;
        return HttpResponse.json({ accepted: true }, { status: 202 });
      }),
      serveFlightLists(
        (d, r) => flightPair(d, r, d === '2027-03-14' && landed ? { list: pairingList({ id: 9 }) } : {}),
        () => ({
          pagesPlanned: 2,
          reading: pressed && !landed ? { departureDate: '2027-03-14', returnDate: '2027-03-24' } : null,
        }),
      ),
    );
    renderDates({ body: BOARD, def: DEF });
    await findBoard();
    await waitFor(() => expect(document.querySelector('[data-flights-for="0"]')).not.toBeNull());
    const status = within(block()).getByTestId('flights-status');
    const button = within(block()).getByRole('button', { name: /^Read flights for this date/ });
    button.focus();
    await act(async () => button.click());
    await waitFor(() => expect(button).toHaveTextContent('Reading flights…'));
    landed = true;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await waitFor(() => expect(status).toHaveTextContent('Flights read for 14 → 24 Mar, 2 return flights'));
    expect(within(block()).getByTestId('flights-pairing')).toBeInTheDocument();
    expect(block().contains(document.activeElement)).toBe(true);
  });

  it('a pressed read that lands with a return read that did not finish says its status note', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'], shouldAdvanceTime: false });
    let pressed = false;
    let landed = false;
    const notVerified = withReturns(
      { status: 'not-verified', rule: null, attempts: [], booking: null },
      { id: 9 },
    );
    server.use(
      http.post(FLIGHT_LISTS_URL, () => {
        pressed = true;
        return HttpResponse.json({ accepted: true }, { status: 202 });
      }),
      serveFlightLists(
        (d, r) => flightPair(d, r, d === '2027-03-14' && landed ? { list: notVerified } : {}),
        () => ({
          pagesPlanned: 2,
          reading: pressed && !landed ? { departureDate: '2027-03-14', returnDate: '2027-03-24' } : null,
        }),
      ),
    );
    renderDates({ body: BOARD, def: DEF });
    await findBoard();
    await waitFor(() => expect(document.querySelector('[data-flights-for="0"]')).not.toBeNull());
    const status = within(block()).getByTestId('flights-status');
    const button = within(block()).getByRole('button', { name: /^Read flights for this date/ });
    await act(async () => button.click());
    await waitFor(() => expect(button).toHaveTextContent('Reading flights…'));
    landed = true;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await waitFor(() =>
      expect(status).toHaveTextContent(
        'return flights are not yet read on this kind of machine; see the recording session in docs/setup.md',
      ),
    );
  });
});

describe('the words (spec §11 banned words)', () => {
  it('the rendered pairing section carries no banned word and no "£" outside a price', async () => {
    await renderList(
      withBooking({ offers: [{ seller: 'QQ Fares', fare: 'Economy Basic', priceMinor: 119_500 }] }),
    );
    expect(findBannedWords(block().textContent ?? '', BANNED_WORD_ALLOWLIST)).toEqual([]);
    expect(screen.getAllByTestId('flights-pairing')).toHaveLength(1);
  });
});

import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { SYNTHETIC_BOOKING_URL } from '@gmt/core/testing';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import type { TripResponse } from '../../../src/api/types.js';
import { COPY } from '../../../src/copy.js';
import type { TripUiState } from '../../../src/state/tripState.js';
import { type CardState, cardOf } from '../../../src/views/Trip/cardState.js';
import { TripView } from '../../../src/views/Trip/TripView.js';
import { API, datePairFigure, definition } from '../../fixtures.js';
import { flightList, listedFlight } from '../../fixtures.searches.js';
import {
  calendarFigure,
  datesList,
  FAILED_AT,
  overPairing,
  pairingFigure,
  provCache,
  readPairing,
  readTrip,
  SEARCH_LINK,
  STATE_FIXTURES,
  syntheticCalendar,
  trip,
  tripBody,
} from '../../fixtures.trip.js';
import { poundsOutsidePrices, renderedCopy } from '../../guards.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';
import { jargonIn, mainPathWords } from '../dates/jargon.js';

// Design 2026-11-08 §6.1 (trip-page plan Task 7): the Trip page over trip reads in the contract's shape. Synthetic values
// only (London → New York); the booking address is the one made-up address every test shares.

const T = COPY.trip;
const DEF = definition({ name: 'London → New York' });
const STATE: TripUiState = {
  departureDate: STATE_FIXTURES.trip.departureDate,
  returnDate: STATE_FIXTURES.trip.returnDate,
  from: [],
  to: [],
  journey: null,
};
const SEARCH = '?view=trip&def=def-0001&depart=2026-11-11&return=2026-11-28&d.nights=17-17';

/** The Trip page over `r` (or over a server error), with every POST to the flight read recorded. */
function renderTrip(r: TripResponse | 'error', state: TripUiState = STATE) {
  const posts: unknown[] = [];
  server.use(
    http.get(`${API}/definitions/:id/trip`, () =>
      r === 'error'
        ? HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 })
        : HttpResponse.json(tripBody(r)),
    ),
    http.post(`${API}/definitions/:id/flight-lists`, async ({ request }) => {
      posts.push(await request.json());
      return HttpResponse.json({ accepted: true });
    }),
  );
  const rendered = renderWithProviders(<TripView definition={DEF} state={state} />, { search: SEARCH });
  return { ...rendered, posts };
}

const card = () => screen.findByRole('region', { name: T.cardLabel });

/** The card's buttons by what they do: read, check, retry (label summaries are not buttons). */
function actionsOf(region: HTMLElement): string[] {
  return within(region)
    .queryAllByRole('button')
    .map((b) => {
      const name = b.textContent ?? '';
      if (name.startsWith('Read flights') || name.startsWith('Try again')) return 'read';
      if (name.startsWith('Check with SearchApi')) return 'check';
      if (name === T.retry) return 'retry';
      return name;
    });
}

describe('a read trip: the answer card (design §6.1)', () => {
  it('the price and "Book on Google Flights ↗" are one link to the booking page, with its line, label and seller', async () => {
    renderTrip(readTrip());
    const c = await card();
    const links = within(c).getAllByRole('link');
    expect(links).toHaveLength(1);
    const book = links[0];
    expect(book).toHaveTextContent('£412 · Book on Google Flights ↗');
    expect(book).toHaveAttribute('href', SYNTHETIC_BOOKING_URL);
    expect(book).toHaveAttribute('target', '_blank');
    expect(book).toHaveAccessibleName('£412 · Book on Google Flights ↗, opens in a new tab');
    expect(c).toHaveTextContent(
      "Opens Google's booking page for these two flights, where the sellers are listed.",
    );
    expect(within(c).getByText(T.caption)).toBeInTheDocument();
    expect(within(c).getByTestId('price-label').querySelector('summary')).toHaveTextContent('Seller · 3h');
    expect(within(c).getByText('Kiwi.com · cheapest of 16 sellers')).toBeInTheDocument();
  });

  it('Out and Back: times, airports, the day, duration, changes, airline, and the day a leg lands when another', async () => {
    renderTrip(readTrip());
    const [out, back] = within(await card()).getAllByTestId('trip-leg');
    expect(out).toHaveTextContent('Out09:15 LHR → 14:55 JFK');
    expect(out).toHaveTextContent('Wed 11 Nov · 10h 40m · 1 change · Aer Lingus');
    expect(back).toHaveTextContent('Back18:30 JFK → 06:25+1 LHR');
    expect(back).toHaveTextContent('Sat 28 Nov, lands Sun 29 Nov · 6h 55m · direct · Virgin Atlantic');
  });

  it('the heading names the dates and nights, under Trips › the search › the dates', async () => {
    renderTrip(readTrip());
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Wed 11 Nov → Sat 28 Nov · 17 nights' }),
    ).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: T.crumbsLabel });
    expect(crumbs).toHaveTextContent('Trips › London → New York › Wed 11 Nov → Sat 28 Nov');
    const back = within(crumbs).getByRole('link', { name: 'London → New York' });
    // why: the search page's filters (`d.*`) travel back with the breadcrumb
    expect(back.getAttribute('href')).toContain('view=dates');
    expect(back.getAttribute('href')).toContain('d.nights=17-17');
    expect(back.getAttribute('href')).not.toContain('depart=');
  });

  it('without a booking page the price says "Find on Google Flights ↗" to the search for the dates, never "Book"', async () => {
    renderTrip(
      readTrip({
        figure: pairingFigure(readPairing({ bookingUrl: null })),
      }),
    );
    const c = await card();
    const link = within(c).getByRole('link');
    expect(link).toHaveTextContent('£412 · Find on Google Flights ↗');
    expect(link).toHaveAttribute('href', SEARCH_LINK.url);
    expect(c).not.toHaveTextContent(/Book/);
    expect(c).not.toHaveTextContent(T.bookingPageLine);
  });

  it('a verified figure with a GET booking says "Book on <host> ↗"', async () => {
    renderTrip(
      trip({
        figure: datePairFigure(),
        booking: { kind: 'get', url: 'https://www.google.com/travel/clk/f?id=1', host: 'www.google.com' },
      }),
    );
    const link = within(await card()).getByRole('link');
    expect(link).toHaveTextContent('£412 · Book on www.google.com ↗');
    expect(link).toHaveAttribute('href', 'https://www.google.com/travel/clk/f?id=1');
    expect(within(await card()).getByTestId('price-label')).toHaveTextContent('Seller · age unknown');
  });

  it('a synthetic price anywhere in the read raises the banner, and nothing links out of the app', async () => {
    renderTrip(readTrip({ calendar: syntheticCalendar }));
    expect(await screen.findByRole('alert')).toHaveTextContent(COPY.syntheticBanner);
    await card();
    expect(document.querySelectorAll('a[target="_blank"]')).toHaveLength(0);
    expect(screen.getByTestId('trip-page')).toHaveTextContent('£412');
  });
});

/** What each state's card says (design §6.1's table, Rulings 3 and 4), and exactly its own actions. */
const EXPECT: Record<CardState['kind'], { says: string | RegExp; actions: string[] }> = {
  unreachable: { says: T.unreachable, actions: ['retry'] },
  'outside-window': { says: T.outsideWindow, actions: [] },
  verified: { says: T.caption, actions: ['read', 'check'] },
  trip: { says: T.caption, actions: ['read', 'check'] },
  reading: { says: `${T.reading(2)} ${T.calendarShowed} £388${T.sentenceEnd}`, actions: [] },
  'calendar-with-trip': { says: T.calendarWithTrip('2d ago'), actions: ['read'] },
  'none-within': {
    says: `${T.noneWithin('4h ago', 'your 25h limit each way')} ${T.cheapestRead} £455${T.cheapestReadLeg('27h 10m')}`,
    actions: ['read'],
  },
  'other-limits': { says: T.otherLimits('4h ago'), actions: ['read'] },
  'outbound-only': { says: T.outboundOnly('4h ago'), actions: ['read'] },
  'no-return': { says: T.noReturn('4h ago'), actions: ['read'] },
  'read-without-calendar': { says: T.readWithoutCalendar('3h ago'), actions: ['read'] },
  'calendar-only': { says: T.calendarOnly, actions: ['read'] },
  gone: { says: T.gone, actions: ['read'] },
  'over-journey-limit': { says: T.overJourneyLimit, actions: ['read'] },
  'could-not-read': { says: T.couldNotRead, actions: ['read'] },
  'no-price': { says: T.noPrice, actions: ['read'] },
  'not-offered': { says: T.notOffered, actions: [] },
  'not-reached': { says: T.notReached, actions: [] },
  'browser-unavailable': { says: T.browserUnavailable, actions: [] },
  'not-searched': { says: T.notSearched, actions: [] },
};

const isKind = (k: string): k is CardState['kind'] => Object.hasOwn(EXPECT, k);
/** Every state of the card, from the table above (a `Record` over the union, so none is left out). */
const KINDS = Object.keys(EXPECT).filter(isKind);

describe('every state of the card says its sentence, with exactly its own actions (design §6.1)', () => {
  it.each(KINDS)('%s', async (kind) => {
    const r = STATE_FIXTURES[kind];
    expect(cardOf(r, kind === 'unreachable').state.kind).toBe(kind);
    renderTrip(kind === 'unreachable' ? 'error' : r);
    const c = await card();
    await waitFor(() => expect(c.dataset.state).toBe(kind));
    expect(c).toHaveTextContent(EXPECT[kind].says);
    expect(actionsOf(c)).toEqual(EXPECT[kind].actions);
  });

  it('calendar-only makes the read the main action; the other states keep it secondary', async () => {
    renderTrip(STATE_FIXTURES['calendar-only']);
    const read = within(await card()).getByRole('button', { name: T.readFlights(false, 2) });
    expect(read).toHaveClass('trip-btn-primary');
  });

  it('reading: no action, a polite status with an estimate bar', async () => {
    renderTrip(STATE_FIXTURES.reading);
    const status = within(await card()).getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status.querySelector('.trip-progress')).toHaveAttribute('aria-hidden', 'true');
  });

  it('outside the window links back to the search', async () => {
    renderTrip(STATE_FIXTURES['outside-window']);
    const link = within(await card()).getByRole('link', { name: T.backToSearch('London → New York') });
    expect(link.getAttribute('href')).toContain('view=dates');
    expect(screen.queryByRole('heading', { name: T.otherHeading })).toBeNull();
    expect(screen.queryByTestId('about-price')).toBeNull();
  });

  it('unreachable: Retry asks again', async () => {
    const { user } = renderTrip('error');
    const c = await card();
    server.use(http.get(`${API}/definitions/:id/trip`, () => HttpResponse.json(tripBody(readTrip()))));
    await user.click(within(c).getByRole('button', { name: T.retry }));
    expect(await within(await card()).findByText(T.caption)).toBeInTheDocument();
  });

  it("the label is the price's own: a cached figure says Cached, a superseded one Not seen again", async () => {
    const cached = trip({
      figure: calendarFigure({
        pairingRead: 'over-limit',
        pairing: overPairing(),
        price: { pricePence: 38_800, provenance: provCache, stale: false, ageHours: 2, truncated: false },
      }),
      flightList: STATE_FIXTURES['none-within'].flightList,
    });
    const { unmount } = renderTrip(cached);
    expect(within(await card()).getByTestId('price-label')).toHaveTextContent('Cached · 2h');
    unmount();
    renderTrip(
      trip({
        figure: calendarFigure({ pairingRead: 'outbound-only', superseded: true }),
        flightList: datesList(),
      }),
    );
    const c = await card();
    await waitFor(() => expect(c.dataset.state).toBe('outbound-only'));
    expect(within(c).getByTestId('price-label')).toHaveTextContent('Not seen again · 3h');
  });

  it("the newest read's failure is said above the card, and the read is offered again", async () => {
    renderTrip(
      trip({
        figure: calendarFigure({ pairingRead: 'list-failed', listReason: 'network' }),
        listFailure: { at: FAILED_AT, cause: 'network' },
      }),
    );
    const c = await card();
    expect(within(c).getByTestId('could-not-read')).toHaveTextContent(
      "The flights page didn't load at 14:40: the connection to it failed. Nothing was saved.",
    );
    expect(within(c).getByRole('button', { name: T.tryAgain(2) })).toBeInTheDocument();
  });
});

describe('the read by hand (Ruling 2)', () => {
  it("posts the card's dates and airport pair", async () => {
    const { user, posts } = renderTrip(STATE_FIXTURES['calendar-only']);
    await user.click(within(await card()).getByRole('button', { name: T.readFlights(false, 2) }));
    expect(await screen.findByText(T.readStarted)).toBeInTheDocument();
    expect(posts).toEqual([
      { departureDate: '2026-11-11', returnDate: '2026-11-28', origin: 'LHR', destination: 'JFK' },
    ]);
  });

  it('is not offered when it would not go', async () => {
    renderTrip({
      ...STATE_FIXTURES['calendar-only'],
      read: { ...STATE_FIXTURES['calendar-only'].read, wouldGo: false },
    });
    const c = await card();
    expect(actionsOf(c)).toEqual([]);
    expect(within(c).queryByTestId('read-unavailable')).toBeNull();
  });

  it('when flights cannot be read here it says why in one sentence, with no button', async () => {
    renderTrip({
      ...STATE_FIXTURES['calendar-only'],
      read: {
        ...STATE_FIXTURES['calendar-only'].read,
        available: false,
        unavailableReason: 'not-configured',
      },
    });
    const c = await card();
    expect(actionsOf(c)).toEqual([]);
    expect(within(c).getByTestId('read-unavailable')).toHaveTextContent(COPY.flights.unavailable);
  });

  it('a cabin the browser does not read says so', async () => {
    renderTrip({
      ...STATE_FIXTURES['calendar-only'],
      read: { ...STATE_FIXTURES['calendar-only'].read, available: false, unavailableReason: 'cabin' },
    });
    expect(within(await card()).getByTestId('read-unavailable')).toHaveTextContent(
      COPY.flights.unavailableCabin,
    );
  });

  it('a refused read says why', async () => {
    const { user } = renderTrip(STATE_FIXTURES['calendar-only']);
    server.use(
      http.post(`${API}/definitions/:id/flight-lists`, () =>
        HttpResponse.json({ error: { code: 'browser_busy', message: 'busy' } }, { status: 409 }),
      ),
    );
    await user.click(within(await card()).getByRole('button', { name: T.readFlights(false, 2) }));
    expect(await screen.findByText(COPY.flights.busy)).toBeInTheDocument();
  });

  it('the SearchApi check is not offered when the search does not let SearchApi verify', async () => {
    server.use(http.get(`${API}/definitions/:id/trip`, () => HttpResponse.json(tripBody(readTrip()))));
    renderWithProviders(
      <TripView
        definition={definition({
          providers: {
            discovery: ['travelpayouts'],
            verification: [],
            discoveryRefreshHours: { travelpayouts: 168 },
          },
        })}
        state={STATE}
      />,
      { search: SEARCH },
    );
    expect(actionsOf(await card())).toEqual(['read']);
  });

  it('nor without a SearchApi key', async () => {
    renderTrip(readTrip({ verificationConfigured: false }));
    expect(actionsOf(await card())).toEqual(['read']);
  });
});

describe('Other flights on these dates (design §6.1)', () => {
  it('absent with no flight list; About and the log still render', async () => {
    renderTrip(STATE_FIXTURES['calendar-only']);
    await card();
    expect(screen.queryByRole('heading', { name: T.otherHeading })).toBeNull();
    expect(screen.getByTestId('about-price')).toBeInTheDocument();
    expect(screen.getByTestId('search-log')).toBeInTheDocument();
  });

  it("other returns are Google's price, other outbounds Google's list with returns not read, each a Find link named by its times", async () => {
    renderTrip(readTrip());
    const section = (await screen.findByRole('heading', { name: T.otherHeading })).closest('section');
    if (section === null) throw new Error('no section');
    const rows = within(section).getAllByTestId('other-flight');
    const returns = rows.filter((r) => r.textContent?.includes('Back '));
    const outbounds = rows.filter((r) => r.textContent?.includes('Out '));
    expect(returns).toHaveLength(2);
    expect(outbounds).toHaveLength(3);
    for (const r of returns) {
      expect(within(r).getByTestId('price-label')).toHaveTextContent('Google price · 3h');
      expect(r).not.toHaveTextContent(T.returnsNotRead);
    }
    for (const r of outbounds) {
      expect(within(r).getByTestId('price-label')).toHaveTextContent('Google list · 3h');
      expect(r).toHaveTextContent(T.returnsNotRead);
    }
    const first = within(returns[0] ?? section).getByRole('link');
    expect(first).toHaveAccessibleName(
      '£436 · Find on Google Flights ↗, Back 21:10 JFK → 09:15 LHR, opens in a new tab',
    );
    expect(first).toHaveAttribute('href', SEARCH_LINK.url);
    expect(within(section).queryByText(/Book/)).toBeNull();
  });

  it('rows over the limit and dearer fold into one line, and Show them shows them', async () => {
    const { user } = renderTrip(readTrip());
    const section = (await screen.findByRole('heading', { name: T.otherHeading })).closest('section');
    if (section === null) throw new Error('no section');
    expect(section).toHaveTextContent('9 more outbounds read: 6 over your 25h limit, 3 dearer.');
    await user.click(within(section).getByRole('button', { name: T.showThem }));
    expect(within(section).getAllByTestId('other-flight')).toHaveLength(2 + 12);
    expect(within(section).queryByRole('button', { name: T.showThem })).toBeNull();
  });

  it('over-limit rows that break more than the journey limit are said as outside your limits', async () => {
    const list = flightList({
      departureDate: '2026-11-11',
      returnDate: '2026-11-28',
      flights: [
        listedFlight({ stops: 3, amountMinor: 50_000 }),
        listedFlight({ durationMinutes: 1600, amountMinor: 51_000 }),
      ],
    });
    renderTrip(trip({ figure: calendarFigure({ pairingRead: 'outbound-only' }), flightList: list }));
    const section = (await screen.findByRole('heading', { name: T.otherHeading })).closest('section');
    expect(section).toHaveTextContent('2 more outbounds read: 2 outside your limits.');
  });
});

describe('About this price and the search log (design §6.1)', () => {
  it('are closed folds', async () => {
    renderTrip(readTrip());
    await card();
    for (const id of ['about-price', 'search-log']) {
      const d = screen.getByTestId(id);
      expect(d.tagName).toBe('DETAILS');
      expect(d).not.toHaveAttribute('open');
    }
  });

  it('About names what the price is, what was and was not checked, the calendar and cache, and the other airport pairs', async () => {
    const { user } = renderTrip(readTrip());
    await card();
    const about = screen.getByTestId('about-price');
    await user.click(within(about).getByText(T.aboutSummary));
    expect(about).toHaveAttribute('open');
    const items = within(about)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual([
      `£412 ${T.about.seller('Kiwi.com', 'today at 13:00')}`,
      T.about.checkedJourney('25h'),
      T.about.notCheckedTrip,
      `${T.about.calendarShowed} £388 ${T.about.forTheseDates} Calendar · 3h${T.labelDetail.calendar}fetched 3h ago`,
      T.about.cachedNone,
      'LGW → JFK: no price listed in the latest search',
      "LHR → EWR: couldn't be read in the latest search",
      'LGW → EWR: not searched in the latest search',
    ]);
  });

  it("About on a calendar price says what it is and what wasn't checked", async () => {
    const { user } = renderTrip({
      ...STATE_FIXTURES['calendar-only'],
      cached: { ...syntheticCalendar, provenance: provCache, ageHours: 2 },
    });
    await card();
    const about = screen.getByTestId('about-price');
    await user.click(within(about).getByText(T.aboutSummary));
    const items = within(about)
      .getAllByRole('listitem')
      .map((li) => li.textContent ?? '');
    expect(items[0]).toBe(`£388 ${T.about.calendar('today at 13:00')}`);
    expect(items[1]).toBe(T.about.notCheckedCalendar);
    expect(items[2]).toBe(T.about.calendarNone);
    expect(items[3]).toContain(`${T.about.cachedShowed} £300 ${T.about.forTheseDates} Cached · 2h`);
  });

  it('the log: its summary, five rows newest first in its words, then every row with each source', async () => {
    const { user } = renderTrip(readTrip());
    await card();
    const log = screen.getByTestId('search-log');
    expect(log.querySelector('summary')).toHaveTextContent(
      'Search log for these dates · 7 searches since 8 Oct',
    );
    await user.click(within(log).getByText(T.logSummary));
    expect(
      within(log)
        .getAllByTestId('log-row')
        .map((r) => r.textContent),
    ).toEqual([
      'Today 14:40 · calendar £388 · flights £412 Kiwi.com',
      'Tue 13 Oct · read by hand · flights £409',
      "Tue 13 Oct · couldn't read flights: the connection to it failed",
      'Mon 12 Oct · calendar £390 · outbound flights read, returns not',
      'Sun 11 Oct · calendar £395 · flights read, none within your limits',
    ]);
    await user.click(within(log).getByRole('button', { name: T.logShowAll(7) }));
    const all = within(log)
      .getAllByTestId('log-row')
      .map((r) => r.textContent);
    expect(all).toHaveLength(7);
    expect(all[0]).toBe(
      'Today 14:40 · calendar £388 (Calendar, the browser worker) · flights £412 (Seller, the browser worker) Kiwi.com',
    );
    expect(all[5]).toBe(
      'Sat 10 Oct · calendar £395 (Calendar, the browser worker) · flights read under different limits',
    );
    expect(all[6]).toBe('Thu 8 Oct · calendar £400 (Calendar, the browser worker) · flights not read');
    await user.click(within(log).getByRole('button', { name: T.logShowFewer }));
    expect(within(log).getAllByTestId('log-row')).toHaveLength(5);
  });

  it('an empty log says so', async () => {
    renderTrip(STATE_FIXTURES['calendar-only']);
    await card();
    expect(screen.getByTestId('search-log').querySelector('summary')).toHaveTextContent(
      `${T.logSummary} ${T.logNone}`,
    );
  });
});

describe('the page says no banned word, no main-path term, and no "£" outside a price (spec §11; design §6.1)', () => {
  // why: design §6.1 "Gone from this page": the words the Trip page never says, beyond the main path's own list
  const TRIP_WORDS: ReadonlyArray<readonly [string, RegExp]> = [
    ['definition', /\bdefinitions?\b/i],
    ['cell', /\bcells?\b/i],
    ['date pair', /\bdate pairs?\b/i],
    ['basis', /\bbasis\b/i],
    ['discovery', /\bdiscovery\b/i],
    ['itinerary search', /\bitinerary search\b/i],
    ['verdict', /\bverdicts?\b/i],
    ['reused', /\breused\b/i],
    ['superseded', /\bsuperseded\b/i],
    ['billed calls', /\bbilled calls?\b/i],
  ];
  it.each(KINDS)('%s', async (kind) => {
    const { user } = renderTrip(kind === 'unreachable' ? 'error' : STATE_FIXTURES[kind]);
    const c = await card();
    await waitFor(() => expect(c.dataset.state).toBe(kind));
    // why: every fold and label opened, so their words are swept too
    for (const s of document.querySelectorAll('summary')) await user.click(s);
    const words = mainPathWords();
    expect(jargonIn(words)).toEqual([]);
    expect(TRIP_WORDS.filter(([, re]) => re.test(words)).map(([w]) => w)).toEqual([]);
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST).map((h) => h.word)).toEqual([]);
    expect(poundsOutsidePrices()).toEqual([]);
  });
});

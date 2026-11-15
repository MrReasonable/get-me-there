import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { asIsoDate } from '@gmt/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { COPY } from '../../../src/copy.js';
import {
  at,
  bucketsOf,
  calendarFig,
  DATES_SPACE,
  type DatesOptions,
  pairingFig,
  priced,
  pricedPair,
  workedDates,
} from '../../fixtures.dates.js';
import { poundsOutsidePrices } from '../../guards.js';
import { serveDates } from '../../msw/datesHandlers.js';
import { server } from '../../msw/server.js';
import { setViewportWidth } from '../../viewport.js';
import { dayButton, findCalendar, findLower, renderDates } from './render.js';

// Trips and Search plan, Ruling 18 (Task 9; mockup 02's Calendar): the window's months, each day a button printing its
// one price on the heat ramp (a dot on a trip's), or why it prints none; its name; the five-item key; the phone's one
// month with its buttons and swipe; the anchor "See all on the calendar" and the Trips cards land on.

const C = COPY.calendar;
const months = () => screen.getByTestId('calendar-months');
const days = () => [...months().querySelectorAll<HTMLButtonElement>('button[data-day]')];

/** Twelve current calendar prices (£300–£410, banded) on 14–25 Mar, one superseded day, the rest no cached data. */
const twelve: DatesOptions = {
  rest: { no_data: 4 },
  pairs: {
    ...Object.fromEntries(
      Array.from({ length: 12 }, (_x, i) => [
        at(`2027-03-${String(14 + i).padStart(2, '0')}`, 10),
        pricedPair(priced(30_000 + i * 1_000)),
      ]),
    ),
    [at('2027-03-31', 11)]: pricedPair(priced(10_000, { superseded: true })),
  },
};

describe('the calendar’s months (Ruling 18)', () => {
  it('draws the window’s months in order, each a table captioned by its name, a button for each day of the window', async () => {
    renderDates({ body: workedDates() });
    await findCalendar();
    const tables = within(months()).getAllByRole('table');
    expect(tables.map((t) => t.querySelector('caption')?.textContent)).toEqual(['Mar 2027', 'Apr 2027']);
    // 14 Mar to 13 Apr: 31 days, each one button; the month's other days are drawn but inert
    expect(days()).toHaveLength(31);
    expect(days()[0]?.dataset.day).toBe('2027-03-14');
    expect(days().at(-1)?.dataset.day).toBe('2027-04-13');
    const before = within(tables[0] ?? document.body).getByText('13', { selector: '.cal-out' });
    expect(before.closest('button')).toBeNull();
    expect(before).toHaveAttribute('aria-hidden', 'true');
  });

  it('heads the section "Calendar", says what a day shows over the stays in view, and holds the anchor', async () => {
    renderDates({ body: workedDates() });
    await findCalendar();
    const region = screen.getByRole('region', { name: C.heading });
    expect(region).toHaveTextContent(C.lead(10, 12));
    expect(C.lead(10, 12)).toBe(
      'Each day shows its cheapest trip with flights read, or else its lowest calendar price, for any stay from 10 to 12 nights. Pick a day to see its stays.',
    );
    expect(C.lead(10, 10)).toContain('for a stay of 10 nights.');
    expect(document.getElementById('calendar')).toContainElement(months());
  });

  it('each day prints one price inside a PriceCell, and its name gives the date, price and label (Ruling 18)', async () => {
    renderDates({ body: workedDates() });
    await findCalendar();
    expect(dayButton('2027-03-15')).toHaveAccessibleName('Mon 15 Mar, £305, Calendar · 2h');
    expect(within(dayButton('2027-03-15')).getByTestId('price-cell')).toHaveTextContent('£305');
    // a trip with flights read (the current verified £412) prints over the cheaper calendar £300, with the dot
    expect(dayButton('2027-03-14')).toHaveAccessibleName(
      'Sun 14 Mar, £412, Google price · 2h, trip with flights read',
    );
    expect(within(dayButton('2027-03-14')).getByTestId('price-cell')).toHaveTextContent('£412');
    expect(dayButton('2027-03-14')).toHaveAttribute('data-trip');
    expect(within(dayButton('2027-03-14')).getByText(C.tripGlyph)).toHaveAttribute('aria-hidden', 'true');
    expect(dayButton('2027-03-15')).not.toHaveAttribute('data-trip');
    expect(poundsOutsidePrices()).toEqual([]);
  });

  it('a stale price shows the label’s amber and says so in its name', async () => {
    renderDates({ body: workedDates() });
    await findCalendar();
    expect(dayButton('2027-03-25')).toHaveAccessibleName(
      "Thu 25 Mar, £340, Calendar · 2h, older than this search's refresh",
    );
    expect(dayButton('2027-03-25')).toHaveAttribute('data-stale');
    expect(dayButton('2027-03-15')).not.toHaveAttribute('data-stale');
    // why: jsdom computes no colour; the amber is the stylesheet's, on the price chip of a stale day
    const css = readFileSync(resolve(__dirname, '../../../src/views/Dates/dates.css'), 'utf8');
    expect(css).toMatch(/\.cal-day\[data-stale\] \.cal-dp\s*\{[^}]*color: var\(--t-warn\)/);
  });

  it('a day without a price says why, in its name and on the day: no price, couldn’t read, not searched, not seen again', async () => {
    renderDates({ body: workedDates() });
    await findCalendar();
    expect(dayButton('2027-03-17')).toHaveAccessibleName('Wed 17 Mar, no price');
    expect(dayButton('2027-03-17')).toHaveTextContent(C.noPrice);
    expect(dayButton('2027-03-18')).toHaveAccessibleName("Thu 18 Mar, couldn't read");
    expect(dayButton('2027-03-18')).toHaveTextContent(C.couldntReadGlyph);
    expect(dayButton('2027-03-21')).toHaveAccessibleName('Sun 21 Mar, not searched');
    expect(dayButton('2027-03-21')).toHaveAttribute('data-mark', 'not-searched');
    // a superseded calendar price and a verified one the latest search did not see: no price, "not seen again"
    expect(dayButton('2027-03-16')).toHaveAccessibleName('Tue 16 Mar, not seen again');
    expect(dayButton('2027-03-20')).toHaveAccessibleName('Sat 20 Mar, not seen again');
    expect(within(dayButton('2027-03-16')).queryByTestId('price-cell')).toBeNull();
  });

  it('shades the printed prices on the heat ramp, lower to higher, current prices only', async () => {
    renderDates({ body: twelve });
    await findCalendar();
    expect(dayButton('2027-03-14')).toHaveAttribute('data-heat', '1');
    expect(dayButton('2027-03-19')).toHaveAttribute('data-heat', '3');
    expect(dayButton('2027-03-25')).toHaveAttribute('data-heat', '5');
    // the superseded £100 is off the scale: its day prints nothing and takes no step
    expect(dayButton('2027-03-31')).not.toHaveAttribute('data-heat');
    expect(dayButton('2027-03-26')).not.toHaveAttribute('data-heat');
  });

  it('fewer than ten prices take the one flat step', async () => {
    renderDates({ body: workedDates() });
    await findCalendar();
    expect(dayButton('2027-03-15')).toHaveAttribute('data-heat', 'flat');
  });

  it('the stay filter applies first: each day prints the cheapest of its stays in view', async () => {
    renderDates({
      body: {
        rest: { no_data: 4 },
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(priced(30_000)),
          [at('2027-03-14', 12)]: pricedPair(priced(45_000)),
        },
      },
      search: '?view=dates&def=def-0001&d.nights=11-12',
    });
    await findCalendar();
    expect(dayButton('2027-03-14')).toHaveAccessibleName('Sun 14 Mar, £450, Calendar · 2h');
  });

  it('a day before today is blank and inert; today is a button', async () => {
    // why: the web tests' clock is 14 Oct 2026
    renderDates({
      body: {
        space: {
          departureFrom: asIsoDate('2026-10-10'),
          departureTo: asIsoDate('2026-10-20'),
          minNights: 10,
          maxNights: 10,
        },
        rest: { no_data: 4 },
        pairs: {
          [at('2026-10-12', 10)]: pricedPair(priced(30_000)),
          [at('2026-10-14', 10)]: pricedPair(priced(31_000)),
        },
      },
    });
    await findCalendar();
    expect(days().map((b) => b.dataset.day)[0]).toBe('2026-10-14');
    expect(document.querySelector('button[data-day="2026-10-12"]')).toBeNull();
    expect(within(months()).getByText('12', { selector: '.cal-out' })).not.toHaveTextContent('£');
  });
});

describe('the key (Ruling 18): five items', () => {
  it('the heat scale, the dot, the cross, no price and the hatching, in words', async () => {
    renderDates({ body: workedDates() });
    await findCalendar();
    const key = screen.getByRole('list', { name: C.key.label });
    const items = within(key).getAllByRole('listitem');
    expect(items.map((i) => i.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Shade by price: lower higher',
      '● a trip with flights read; other prices are calendar prices, not fares',
      "× couldn't read",
      "no price (not 'no flights')",
      'hatched: not searched or not reached',
    ]);
    // the five steps of the ramp, lowest first, are drawn and hidden from assistive technology
    expect(items[0]?.querySelectorAll('[data-heat]')).toHaveLength(5);
    expect(
      [...(items[0]?.querySelectorAll<HTMLElement>('[data-heat]') ?? [])].map((s) => s.dataset.heat),
    ).toEqual(['1', '2', '3', '4', '5']);
    expect(items[1]?.querySelector('[aria-hidden="true"]')).toHaveTextContent('●');
  });
});

describe('the phone calendar (Ruling 18: month buttons beside swipe at 375 px)', () => {
  it('one month at a time with Previous and Next month', async () => {
    setViewportWidth(375);
    const { user } = renderDates({ body: workedDates() });
    await findCalendar();
    expect(within(months()).getAllByRole('table')).toHaveLength(1);
    expect(within(months()).getByRole('table', { name: 'Mar 2027' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: C.previousMonth })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: C.nextMonth }));
    expect(within(months()).getByRole('table', { name: 'Apr 2027' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: C.nextMonth })).toBeDisabled();
    expect(days()).toHaveLength(13);
  });

  it('a swipe left shows the next month, a swipe right the one before; a short drag turns nothing', async () => {
    setViewportWidth(375);
    renderDates({ body: workedDates() });
    await findCalendar();
    fireEvent.pointerDown(months(), { pointerType: 'touch', clientX: 300 });
    fireEvent.pointerUp(months(), { pointerType: 'touch', clientX: 280 });
    expect(within(months()).getByRole('table', { name: 'Mar 2027' })).toBeInTheDocument();
    fireEvent.pointerDown(months(), { pointerType: 'touch', clientX: 300 });
    fireEvent.pointerUp(months(), { pointerType: 'touch', clientX: 100 });
    await waitFor(() =>
      expect(within(months()).getByRole('table', { name: 'Apr 2027' })).toBeInTheDocument(),
    );
    fireEvent.pointerDown(months(), { pointerType: 'touch', clientX: 100 });
    fireEvent.pointerUp(months(), { pointerType: 'touch', clientX: 300 });
    await waitFor(() =>
      expect(within(months()).getByRole('table', { name: 'Mar 2027' })).toBeInTheDocument(),
    );
  });

  // why: CodeRabbit CR8: a re-read whose window holds fewer months than the one shown keeps a month on screen, and
  // the month buttons work from it at once
  it('a re-read with fewer months shows its last month, with working month buttons', async () => {
    setViewportWidth(375);
    const { user, client } = renderDates({ body: workedDates() });
    await findCalendar();
    await user.click(screen.getByRole('button', { name: C.nextMonth }));
    expect(within(months()).getByRole('table', { name: 'Apr 2027' })).toBeInTheDocument();
    server.use(serveDates(workedDates({ space: { ...DATES_SPACE, departureTo: asIsoDate('2027-03-31') } })));
    await act(() => client.refetchQueries({ queryKey: ['date-pairs'] }));
    await waitFor(() =>
      expect(within(months()).getByRole('table', { name: 'Mar 2027' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: C.nextMonth })).toBeDisabled();
    expect(screen.getByRole('button', { name: C.previousMonth })).toBeDisabled();
  });

  it('a desktop draws every month and no month buttons', async () => {
    renderDates({ body: workedDates() });
    await findCalendar();
    expect(within(months()).getAllByRole('table')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: C.nextMonth })).toBeNull();
  });
});

describe('the calendar’s anchor (Task 8 and Task 6 carried notes)', () => {
  it('"See all on the calendar" links to it', async () => {
    renderDates({ body: workedDates() });
    const lower = await findLower();
    expect(within(lower).getByRole('link', { name: COPY.searchPage.seeAll })).toHaveAttribute(
      'href',
      '#calendar',
    );
  });

  it('a page opened at #calendar scrolls the calendar into view once it has drawn, then drops the fragment', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const before = window.history.length;
    renderDates({ body: workedDates(), search: '?view=dates&def=def-0001#calendar' });
    await findCalendar();
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('calendar'));
    // why: final review I1: the landing is consumed once, the way `d.fold` is, so the anchor never travels on
    expect([window.location.search, window.location.hash]).toEqual(['?view=dates&def=def-0001', '']);
    expect(window.history.length).toBe(before);
    scroll.mockRestore();
  });

  it('a page opened without it does not scroll', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    renderDates({ body: workedDates() });
    await findCalendar();
    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
  });
});

describe('the calendar is a pair of dates’ prices, never fares (Ruling 18)', () => {
  it('a trip’s day on a search with a read pairing names the seller’s label', async () => {
    renderDates({
      body: {
        rest: { no_data: 4 },
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(calendarFig()),
          [at('2027-03-14', 11)]: pricedPair(pairingFig()),
          [at('2027-03-15', 10)]: { buckets: bucketsOf({ error: 4 }) },
        },
      },
    });
    await findCalendar();
    expect(dayButton('2027-03-14')).toHaveAccessibleName(
      'Sun 14 Mar, £1,180, Seller · 4h, trip with flights read',
    );
  });

  it('the window is the search’s: a day after it is inert', async () => {
    renderDates({ body: { ...workedDates(), space: DATES_SPACE } });
    await findCalendar();
    expect(document.querySelector('button[data-day="2027-04-14"]')).toBeNull();
  });
});

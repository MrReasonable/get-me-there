import { asIata, asIsoDate, asIsoMonth, type Buckets, monthOf } from '@gmt/core';
import { within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { CalendarGrid, FOCUS_RING } from '../../../src/views/Calendar/CalendarGrid.js';
import { CalendarLegend } from '../../../src/views/Calendar/CalendarLegend.js';
import { buildCalendarModel } from '../../../src/views/Calendar/model.js';
import type { DayBasis, GridDay } from '../../../src/views/Calendar/types.js';
import {
  cellAt,
  disc,
  gridDay,
  priceAt,
  provCalendarAt,
  provItinerary,
  provSyntheticAt,
  slice,
} from '../../fixtures.wp10.js';
import { expectConsoleErrors } from '../../guards.js';
import { NOW, renderWithProviders } from '../../render.js';

const vDay = (date: string, pence: number): GridDay =>
  gridDay(date, {
    cheapestVerified: priceAt(pence, provItinerary(5), false, cellAt(date, 14)),
    discovery: [disc('searchapi', { priced: 48 })],
  });
const cDay = (date: string, pence: number, stale = false, truncated = false): GridDay =>
  gridDay(date, {
    cheapestCalendar: priceAt(pence, provCalendarAt(5), stale, cellAt(date, 14), truncated),
    discovery: [disc('travelpayouts', { priced: 20, no_data: 4, not_run: 24 })],
  });
const gDay = (date: string, b: Partial<Buckets>): GridDay =>
  gridDay(date, { discovery: [disc('travelpayouts', b)] });
const tenVerified = Array.from({ length: 10 }, (_, i) =>
  vDay(`2027-03-${String(i + 1).padStart(2, '0')}`, 40000 + i * 5000),
);

function renderGrid(
  days: GridDay[],
  basis: DayBasis = 'verified',
  notes: Record<string, string> = {},
  compact = false,
) {
  const onOpen = vi.fn();
  const model = buildCalendarModel(days, basis, NOW);
  const months = [...new Set(days.map((d) => monthOf(d.date)))];
  const r = renderWithProviders(
    <>
      <CalendarLegend model={model} />
      <CalendarGrid
        days={days}
        model={model}
        months={months}
        destinationNotes={notes}
        compact={compact}
        onOpen={onOpen}
      />
    </>,
  );
  return { onOpen, ...r };
}
/** A day's button: the grid is a table of days, each a button with a roving tabIndex. */
function dayCell(date: string): HTMLButtonElement {
  const el = document.querySelector(`button[data-date="${date}"]`);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`no day ${date}`);
  return el;
}
/** The weekday column of a day (Monday = 0). */
function column(date: string): number {
  const td = dayCell(date).closest('td');
  if (td === null) throw new Error(`day ${date} is outside a table cell`);
  return td.cellIndex;
}
/** The compact PriceCell of a day, or of an element inside one. */
function priceCellIn(el: HTMLElement): HTMLElement {
  return within(el).getByTestId('price-cell');
}

describe('calendar grid (spec §11 View B, Accessibility; plan decision 38)', () => {
  it('places each day under its weekday in its own month grid, and draws only the months it is given', () => {
    const days = [vDay('2027-03-14', 41200), vDay('2027-04-01', 41200)];
    const model = buildCalendarModel(days, 'verified', NOW);
    const { getByRole, queryByRole } = renderWithProviders(
      <CalendarGrid
        days={days}
        model={model}
        months={[asIsoMonth('2027-03')]}
        destinationNotes={{}}
        compact={false}
        onOpen={vi.fn()}
      />,
    );
    expect(column('2027-03-14')).toBe(6); // Sunday
    expect(getByRole('table', { name: 'Mar 2027' })).toContainElement(dayCell('2027-03-14'));
    expect(getByRole('columnheader', { name: 'Mon' })).toBeInTheDocument();
    expect(queryByRole('table', { name: 'Apr 2027' })).toBeNull();
  });

  it('colours by one basis in quintiles; other-basis days are hatched, excluded and named in the numeric legend', () => {
    const days = [...tenVerified, cDay('2027-03-13', 30000)];
    const first = renderGrid(days, 'verified');
    expect(['01', '02', '05', '10'].map((d) => dayCell(`2027-03-${d}`).dataset.band)).toEqual([
      '0',
      '0',
      '2',
      '4',
    ]);
    expect(dayCell('2027-03-13')).toHaveClass('day-hatched');
    expect(within(dayCell('2027-03-13')).getByText('not on the colour scale')).toBeInTheDocument();
    expect(within(dayCell('2027-03-01')).getByText('price band 1 of 5, cheapest')).toBeInTheDocument();
    // why: ui-r2-005 — the band number is printed on the face, so neighbouring shades never rest on colour alone.
    expect(dayCell('2027-03-10').querySelector('[data-band-number]')).toHaveTextContent('5');
    expect(dayCell('2027-03-13').querySelector('[data-band-number]')).toBeNull();
    const legend = first.getByTestId('calendar-legend');
    expect(legend).toHaveTextContent(
      'Colour: itinerary-search basis prices on 10 days, in five price bands (quintiles of the days shown)',
    );
    expect(legend).toHaveTextContent('band 1: £400–£450 (2 days)');
    expect(legend).toHaveTextContent('band 5: £800–£850 (2 days)');
    expect(legend).toHaveTextContent(
      'hatched: 1 day shows a calendar price instead and is not on this scale',
    );
    first.unmount();

    const second = renderGrid(days, 'calendar');
    expect(dayCell('2027-03-13').dataset.band).toBe('flat');
    expect(second.getByTestId('calendar-legend')).toHaveTextContent(
      'Colour: one shade for calendar basis prices on 1 day; fewer than 10 days are too few for price bands',
    );
    expect(second.getByTestId('calendar-legend')).toHaveTextContent(
      'hatched: 10 days show a class-verified price instead and are not on this scale',
    );
  });

  it('the legend explains every mark: dashed, stale, coverage, cached, rows read, stay, glyphs with skipped', () => {
    const { getByTestId } = renderGrid([gDay('2027-03-08', { not_run: 1 })], 'calendar');
    const legend = getByTestId('calendar-legend');
    for (const text of [
      'dashed outline: a calendar price; constraints not checked',
      'stale: older than one refresh cycle by fetch age plus any known vendor age',
      'price not confirmed: an itinerary search priced this day',
      'S/M searched with a striped square',
      'cached from £X',
      'cheapest of the rows read',
      'Nn · back <date>',
      '– skipped (a budget stop, a disabled provider or a passed date; reasons in the panel)',
      '○ not searched',
      'its price band, 1 cheapest to 5 dearest',
      '◐ part of the day not searched',
    ])
      expect(legend).toHaveTextContent(text);
    // why: ui-r2-006 — the long explanations fold away; the scale and the glyphs stay open.
    const more = within(legend).getByText('What the marks mean').closest('details');
    expect(more).not.toHaveAttribute('open');
    expect(more).toHaveTextContent('dashed outline');
    expect(more).not.toHaveTextContent('○ not searched');
  });

  it('a day shows price, compact badge, stay and coverage cue; details are in the title and the panel', () => {
    renderGrid([vDay('2027-03-08', 40000), cDay('2027-03-09', 30000, true)], 'verified', {
      JFK: 'onward leg not included',
    });
    const v = within(dayCell('2027-03-08'));
    // why: WP9's compact PriceCell (decision 46): amount, short badge, destination, marks; the rest in its title.
    const price = priceCellIn(dayCell('2027-03-08'));
    expect(price).not.toHaveClass('border-dashed');
    expect(price).toHaveTextContent('SA');
    expect(price).toHaveTextContent('JFK');
    expect(price).toHaveTextContent("vendor's cache age unknown"); // decision 44: labelled, not called stale
    expect(price.getAttribute('title')).toContain('Google Flights via SearchApi');
    expect(price.getAttribute('title')).toContain('onward leg not included');
    expect(v.queryByTestId('provenance')).toBeNull();
    expect(v.getByTestId('day-stay')).toHaveTextContent('14n · back 22 Mar');
    expect(v.getByTestId('coverage-cue')).toHaveTextContent('48/48 searched');
    expect(v.getByTestId('coverage-cue')).toHaveAttribute('data-coverage', 'full');
    const c = within(dayCell('2027-03-09'));
    expect(priceCellIn(dayCell('2027-03-09'))).toHaveClass('border-dashed');
    expect(priceCellIn(dayCell('2027-03-09')).getAttribute('title')).toContain('constraints not checked');
    expect(dayCell('2027-03-09')).toHaveTextContent('stale');
    expect(dayCell('2027-03-09')).toHaveTextContent('£300');
    expect(c.getByTestId('coverage-cue')).toHaveTextContent('24/48 searched');
    expect(c.getByTestId('coverage-cue')).toHaveAttribute('data-coverage', 'partial');
  });

  it('a verified day that hides a cheaper cached fare shows "cached from" with its own destination, note and stay', () => {
    const d = gridDay('2027-03-08', {
      cheapestVerified: priceAt(52000, provItinerary(5), false, cellAt('2027-03-08', 14)),
      cheapestCalendar: priceAt(41000, provCalendarAt(2), false, cellAt('2027-03-08', 12, 'LHR', 'EWR')),
      discovery: [disc('travelpayouts', { priced: 48 })],
    });
    renderGrid([d], 'verified', { EWR: 'onward leg not included' });
    const cached = within(dayCell('2027-03-08')).getByTestId('cached-from');
    expect(cached).toHaveTextContent('cached from');
    expect(cached).toHaveTextContent('£410');
    expect(priceCellIn(cached)).toHaveClass('border-dashed');
    // why: decision 52, review prov-r2-002 — the cheaper fare is EWR for 12 nights, not the day price's JFK for 14.
    expect(priceCellIn(cached)).toHaveTextContent('EWR');
    expect(priceCellIn(cached).getAttribute('title')).toContain('onward leg not included');
    expect(cached).toHaveTextContent('12n · back 20 Mar');
    expect(within(dayCell('2027-03-08')).getAllByTestId('price-cell')[0]).toHaveTextContent('JFK');
  });

  it('a price from a page-capped tile says "cheapest of the rows read" (plan decisions 30, 36)', () => {
    renderGrid([cDay('2027-03-09', 30000, false, true)], 'calendar');
    expect(dayCell('2027-03-09')).toHaveTextContent('cheapest of the rows read');
  });

  it('a synthetic price carries the synthetic badge and source on the day (spec §5.5)', () => {
    renderGrid(
      [
        gridDay('2027-03-09', {
          cheapestCalendar: priceAt(30000, provSyntheticAt(1), false, cellAt('2027-03-09', 14)),
        }),
      ],
      'calendar',
    );
    const price = priceCellIn(dayCell('2027-03-09'));
    expect(price).toHaveTextContent('synthetic');
    expect(price.getAttribute('title')).toContain('synthetic fixture data');
  });

  it('a total that disagrees with its buckets shows "counts inconsistent" instead of a fraction', () => {
    renderGrid(
      [
        gridDay('2027-03-09', {
          cheapestCalendar: priceAt(30000, provCalendarAt(1), false, cellAt('2027-03-09', 14)),
          discovery: [disc('travelpayouts', { priced: 10 }, 48)],
        }),
      ],
      'calendar',
    );
    expect(within(dayCell('2027-03-09')).getByTestId('coverage-cue')).toHaveTextContent(
      'counts inconsistent',
    );
  });

  it('withholds a day price that arrives without provenance', () => {
    // why: PriceBoundary reports the withheld price through console.error, which WP9's harness fails on unless announced.
    expectConsoleErrors(/price withheld|price rendered without valid provenance/);
    const prevent = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', prevent);
    try {
      const broken = vDay('2027-03-08', 40000);
      if (broken.slice.cheapestVerified)
        Object.assign(broken.slice.cheapestVerified, { provenance: undefined });
      renderGrid([broken]);
      expect(dayCell('2027-03-08')).toHaveTextContent('price withheld: provenance missing');
      expect(dayCell('2027-03-08')).not.toHaveTextContent('£400');
    } finally {
      window.removeEventListener('error', prevent);
    }
  });

  it('a day whose itinerary search confirmed no price says "price not confirmed" (decision 48)', () => {
    renderGrid(
      [
        gridDay('2027-03-08', {
          cheapestCalendar: priceAt(41200, provCalendarAt(2), false, cellAt('2027-03-08', 14)),
          verification: { selected: 2, itinerarySearched: 2, onDemand: 0, unconfirmedCells: 1 },
          discovery: [disc('travelpayouts', { priced: 48 })],
        }),
        gridDay('2027-03-09', {
          verification: { selected: 1, itinerarySearched: 1, onDemand: 0, unconfirmedCells: 1 },
          discovery: [disc('travelpayouts', { no_data: 48 })],
        }),
        gridDay('2027-03-10', {
          cheapestVerified: priceAt(52000, provItinerary(5), false, cellAt('2027-03-10', 14)),
          verification: { selected: 2, itinerarySearched: 2, onDemand: 0, unconfirmedCells: 1 },
          discovery: [disc('searchapi', { priced: 48 })],
        }),
      ],
      'calendar',
    );
    expect(within(dayCell('2027-03-08')).getByTestId('day-unconfirmed')).toHaveTextContent(
      'price not confirmed',
    );
    expect(within(dayCell('2027-03-09')).getByTestId('day-unconfirmed')).toHaveTextContent(
      'price not confirmed',
    );
    // why: a confirmed class-verified price is the day's itinerary-search price; other cells' unconfirmed prices are in the panel.
    expect(within(dayCell('2027-03-10')).queryByTestId('day-unconfirmed')).toBeNull();
  });

  it('days without a price show distinct glyphs with text, never blank; a skipped-only day says skipped', () => {
    renderGrid([
      gDay('2027-03-08', { empty: 1, no_data: 1, error: 1, skipped: 1, not_run: 1 }),
      gDay('2027-03-09', { skipped: 48 }),
    ]);
    const glyphs = [...dayCell('2027-03-08').querySelectorAll('[data-glyph]')];
    expect(glyphs.map((g) => g.getAttribute('data-glyph'))).toEqual([
      'empty',
      'no_data',
      'error',
      'skipped',
      'not_run',
    ]);
    expect(new Set(glyphs.map((g) => g.querySelector('[aria-hidden="true"]')?.textContent)).size).toBe(5);
    expect(glyphs.map((g) => g.textContent)).toEqual([
      '∅ 1 no fares',
      '◇ 1 no cached data',
      '✕ 1 error',
      '– 1 skipped',
      '○ 1 not searched',
    ]);
    expect(dayCell('2027-03-09')).toHaveTextContent('– 48 skipped');
    expect(dayCell('2027-03-09')).toHaveClass('bg-slate-100');
  });

  it('a grey day carries the same "S/M searched" cue as a priced day, so its coverage is visible (ui-r2-003)', () => {
    renderGrid([
      gDay('2027-03-08', { empty: 1, not_run: 47 }),
      gDay('2027-03-09', { empty: 47, not_run: 1 }),
    ]);
    const a = within(dayCell('2027-03-08')).getByTestId('coverage-cue');
    expect(a).toHaveTextContent('1/48 searched');
    expect(a).toHaveAttribute('data-coverage', 'partial');
    expect(dayCell('2027-03-08')).toHaveTextContent('∅ 1 no fares');
    expect(dayCell('2027-03-08')).toHaveTextContent('○ 47 not searched');
    expect(within(dayCell('2027-03-09')).getByTestId('coverage-cue')).toHaveTextContent('47/48 searched');
  });

  it('under a destination filter "price not confirmed" follows the count the api returns for it (decision 53, prov-r2-004)', () => {
    const jfk = asIata('JFK');
    const base = { discovery: [disc('travelpayouts', { no_data: 48 })], destination: jfk };
    renderGrid([
      { date: asIsoDate('2027-03-08'), slice: slice({ ...base, unconfirmedCells: 0 }) },
      { date: asIsoDate('2027-03-09'), slice: slice({ ...base, unconfirmedCells: 1 }) },
    ]);
    expect(within(dayCell('2027-03-08')).queryByTestId('day-unconfirmed')).toBeNull();
    expect(within(dayCell('2027-03-09')).getByTestId('day-unconfirmed')).toHaveTextContent(
      'price not confirmed',
    );
  });

  it('a day no run reaches says not searched; a filtered day shows the counts the api computed for its destination', () => {
    const noRun = gridDay('2027-03-08');
    const filtered: GridDay = {
      date: noRun.date,
      slice: slice({
        destination: cellAt('2027-03-08', 1).destination,
        discovery: [disc('travelpayouts', { empty: 3, not_run: 21 })],
      }),
    };
    const first = renderGrid([noRun]);
    expect(dayCell('2027-03-08')).toHaveTextContent('○ not searched');
    expect(dayCell('2027-03-08')).toHaveTextContent('not searched yet: no run covers this day');
    first.unmount();
    renderGrid([filtered]);
    // why: decision 53, ui-r2-004 — the api counted JFK's 24 cells, so "not searched" and "no fares" stay distinct.
    expect(dayCell('2027-03-08')).toHaveTextContent('∅ 3 no fares');
    expect(dayCell('2027-03-08')).toHaveTextContent('○ 21 not searched');
    expect(within(dayCell('2027-03-08')).getByTestId('coverage-cue')).toHaveTextContent('3/24 searched');
  });

  it('is keyboard-operable: arrows, Home/End, PageUp/PageDown, Enter and Space, one tab stop, visible focus', async () => {
    const dates = [
      '2027-03-03',
      '2027-03-29',
      '2027-03-30',
      '2027-03-31',
      '2027-04-01',
      '2027-04-02',
      '2027-04-04',
      '2027-04-06',
      '2027-04-07',
      '2027-04-30',
    ];
    const { onOpen, user } = renderGrid(dates.map((d) => vDay(d, 40000)));
    // why: the legend's "What the marks mean" fold is the first stop; the grid has one stop after it.
    await user.tab();
    await user.tab();
    expect(dayCell('2027-03-03')).toHaveFocus();
    expect(document.querySelectorAll('button[data-date][tabindex="0"]')).toHaveLength(1);
    dayCell('2027-03-30').focus();
    await user.keyboard('{ArrowRight}');
    expect(dayCell('2027-03-31')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(dayCell('2027-04-01')).toHaveFocus(); // across the month boundary
    await user.keyboard('{ArrowDown}');
    expect(dayCell('2027-04-01')).toHaveFocus(); // 2027-04-08 has no data: focus stays
    await user.keyboard('{End}');
    expect(dayCell('2027-04-04')).toHaveFocus(); // Sunday of that week
    await user.keyboard('{Home}');
    expect(dayCell('2027-03-29')).toHaveFocus(); // Monday of that week
    await user.keyboard('{PageDown}');
    expect(dayCell('2027-03-29')).toHaveFocus(); // 29 Apr has no data: focus stays
    dayCell('2027-03-30').focus();
    await user.keyboard('{PageDown}');
    expect(dayCell('2027-04-30')).toHaveFocus();
    await user.keyboard('{PageUp}');
    expect(dayCell('2027-03-30')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenLastCalledWith('2027-03-30', cellAt('2027-03-30', 14));
    await user.keyboard(' ');
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(dayCell('2027-03-30').className).toContain(FOCUS_RING);
  });

  it('at phone width a key that leaves the drawn month asks for the target month (review ui M7)', async () => {
    const days = [vDay('2027-03-30', 40000), vDay('2027-04-01', 40000), vDay('2027-04-30', 40000)];
    const model = buildCalendarModel(days, 'verified', NOW);
    const onMonth = vi.fn();
    const { user } = renderWithProviders(
      <CalendarGrid
        days={days}
        model={model}
        months={[asIsoMonth('2027-03')]}
        destinationNotes={{}}
        compact
        onOpen={vi.fn()}
        onMonth={onMonth}
      />,
    );
    dayCell('2027-03-30').focus();
    await user.keyboard('{PageDown}');
    expect(onMonth).toHaveBeenLastCalledWith('2027-04');
    expect(dayCell('2027-03-30')).toBeInTheDocument();
  });

  it('clicking a glyph day opens the panel with no preselected cell', async () => {
    const { onOpen, user } = renderGrid([gDay('2027-03-08', { not_run: 48 })]);
    await user.click(dayCell('2027-03-08'));
    expect(onOpen).toHaveBeenCalledWith('2027-03-08', null);
  });

  it('decision 54: a verified day price the latest search no longer returned, and a superseded cached fare, say so', () => {
    const d = gridDay('2027-03-08', {
      cheapestVerified: priceAt(52000, provItinerary(5), false, cellAt('2027-03-08', 14), false, {
        notSeenInLatest: { ageHours: 30 },
      }),
      cheapestCalendar: priceAt(41000, provCalendarAt(2), false, cellAt('2027-03-08', 12), false, {
        superseded: true,
      }),
      discovery: [disc('travelpayouts', { priced: 48 })],
    });
    renderGrid([d]);
    const cells = within(dayCell('2027-03-08')).getAllByTestId('price-cell');
    expect(cells[0]).toHaveTextContent('not seen in latest search (30h ago)');
    expect(cells[0]).not.toHaveTextContent('superseded');
    expect(cells[1]).toHaveTextContent('superseded by a later search');
    expect(cells[1]).not.toHaveTextContent('not seen in latest search');
  });

  it('at phone width a day shows its number, band, amount face and one-glyph marks; the rest is in the panel (ui-r2-001)', () => {
    const days = [
      ...tenVerified,
      gridDay('2027-03-20', {
        cheapestCalendar: priceAt(41000, provCalendarAt(2), true, cellAt('2027-03-20', 12), true),
        verification: { selected: 1, itinerarySearched: 1, onDemand: 0, unconfirmedCells: 1 },
        discovery: [disc('travelpayouts', { priced: 20, not_run: 28 })],
      }),
      gDay('2027-03-21', { empty: 2, not_run: 46 }),
    ];
    renderGrid(days, 'verified', { JFK: 'onward leg not included' }, true);
    const priced = dayCell('2027-03-20');
    const face = within(priced).getByTestId('day-price-face');
    const price = priceCellIn(priced);
    expect(price).toHaveAttribute('data-face');
    expect(price).toHaveClass('border-dashed');
    // why: one glyph per mark, the words spoken and in the title: stale, then cheapest of the rows read.
    expect(price.querySelector('[aria-hidden="true"]')).toHaveTextContent('◷…');
    expect(price.getAttribute('title')).toContain('stale');
    expect(price.getAttribute('title')).toContain('cheapest of the rows read');
    expect(price.getAttribute('title')).toContain('JFK');
    expect(price.getAttribute('title')).toContain('onward leg not included');
    expect(face).toHaveTextContent('£410');
    expect(face).toHaveTextContent('price not confirmed');
    expect(face).toHaveTextContent('part of the day not searched');
    // why: stay, cached-from, the badge and the counts are left to the panel at this width.
    expect(within(priced).queryByTestId('day-stay')).toBeNull();
    expect(within(priced).queryByTestId('coverage-cue')).toBeNull();
    // why: provenance without hover (spec §11): the face carries the provider's short mark, the night count and a coverage mark.
    expect(face).toHaveTextContent(COPY.providerShort.travelpayouts);
    expect(within(priced).getByTestId('day-nights')).toHaveTextContent('12n');
    expect(within(priced).getByTestId('day-nights')).toHaveTextContent('◐');
    expect(within(dayCell('2027-03-10')).getByTestId('day-nights')).toHaveTextContent('●');
    const grey = dayCell('2027-03-21');
    expect([...grey.querySelectorAll('[data-glyph]')].map((g) => g.textContent)).toEqual([
      '∅2 no fares',
      '○46 not searched',
    ]);
    expect(dayCell('2027-03-10').querySelector('[data-band-number]')).toHaveTextContent('5');
    expect(document.querySelector('table')).toHaveClass('border-spacing-0.5');
  });
});

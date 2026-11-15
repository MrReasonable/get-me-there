import { asIata } from '@gmt/core';
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { updateSearchParams } from '../../../src/state/urlState.js';
import { airportPairIndex, at, calendarFig, priced, pricedPair, workedDates } from '../../fixtures.dates.js';
import { definition } from '../../fixtures.js';
import { heldDates, serveDatesBy } from '../../msw/datesHandlers.js';
import { server } from '../../msw/server.js';
import { settled } from '../../render.js';
import { calendarRows, findLower, findTrips, renderDates } from './render.js';

// Design 2026-11-08 Ruling 16 (mockup 02) and §9's honesty rule for the web: the one filter row (stay, From, To, One per
// week, and a removable chip for a journey limit applied from elsewhere); a filtered read is never shown with the
// previous read's figures, the stay and the week switch never reach the route, and every control is labelled and
// keyboard-operable.

const P = COPY.searchPage;
const url = () => new URLSearchParams(window.location.search);
const queryOf = (u: URL | undefined) => Object.fromEntries(u?.searchParams ?? []);
const row = () => screen.getByRole('group', { name: P.filterLabel });
const stay = (which: 'min' | 'max') =>
  within(row()).getByRole('textbox', { name: which === 'min' ? P.stayShortest : P.stayLongest });

describe('the filter row (Ruling 16)', () => {
  it('stay, From, To and One per week, each labelled; no journey field, no sort, no Clear filters', async () => {
    renderDates({ body: workedDates() });
    await findTrips();
    const r = row();
    expect(stay('min')).toBeInTheDocument();
    expect(stay('max')).toBeInTheDocument();
    expect(within(r).getByRole('combobox', { name: P.from })).toBeInTheDocument();
    expect(within(r).getByRole('combobox', { name: P.to })).toBeInTheDocument();
    expect(within(r).getByRole('checkbox', { name: P.onePerWeek })).toBeInTheDocument();
    expect(within(r).queryByRole('textbox', { name: /journey/i })).toBeNull();
    expect(screen.queryByRole('button', { name: COPY.clearFilters })).toBeNull();
    // the board's sort went with it (Ruling 21): no column sorts anywhere on the page
    expect(document.querySelector('[aria-sort]')).toBeNull();
  });

  it('From and To offer every airport (by name), or one; a search with one of either has no select for it', async () => {
    const r = renderDates({ body: workedDates() });
    await findTrips();
    const from = within(row()).getByRole('combobox', { name: P.from });
    await waitFor(() =>
      expect([...from.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
        'Heathrow, Gatwick',
        'Heathrow',
        'Gatwick',
      ]),
    );
    r.unmount();
    renderDates({
      body: workedDates({ origins: ['LHR'] }),
      def: definition({ origins: ['LHR'], destinations: ['JFK', 'EWR'] }),
    });
    await findTrips();
    expect(within(row()).queryByRole('combobox', { name: P.from })).toBeNull();
    expect(within(row()).getByRole('combobox', { name: P.to })).toBeInTheDocument();
  });

  it('is operable by keyboard: One per week by Space, From by its select', async () => {
    const { user } = renderDates({ body: workedDates() });
    await findTrips();
    within(row()).getByRole('checkbox', { name: P.onePerWeek }).focus();
    await user.keyboard(' ');
    expect(url().get('d.week')).toBe('best');
    await user.selectOptions(within(row()).getByRole('combobox', { name: P.from }), 'LHR');
    expect(url().get('d.from')).toBe('LHR');
    await user.selectOptions(within(row()).getByRole('combobox', { name: P.from }), '');
    expect(url().get('d.from')).toBeNull();
  });

  it('a stay applies in the browser, with no request, to both sections', async () => {
    const { user, requests, client } = renderDates({
      body: {
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(priced(30_000)),
          [at('2027-03-15', 11)]: pricedPair(priced(31_000)),
          [at('2027-03-16', 12)]: pricedPair(priced(32_000)),
        },
      },
    });
    await findLower();
    await user.type(stay('min'), '11');
    await user.type(stay('max'), '12');
    expect(url().get('d.nights')).toBe('11-12');
    expect(
      calendarRows(await findLower()).map((r) => r.querySelector('[data-testid="price-cell"]')?.textContent),
    ).toEqual(['£310', '£320']);
    await settled(client);
    expect(requests).toHaveLength(1);
  });

  it('a reversed stay is explained beside the fields and not applied', async () => {
    const { user } = renderDates({ body: workedDates() });
    await findTrips();
    await user.type(stay('min'), '12');
    await user.type(stay('max'), '10');
    expect(stay('max')).toHaveAccessibleDescription(P.stayInvalid);
    expect(stay('max')).toHaveAttribute('aria-invalid', 'true');
    expect(url().get('d.nights')).toBeNull();
  });

  it("From refetches the scope: a date whose best figure is LGW still shows its price, LHR's, with From = LHR", async () => {
    const lgw = calendarFig({
      price: { ...calendarFig().price, pricePence: 29_000 },
      origin: asIata('LGW'),
      airportPair: airportPairIndex('LGW', 'JFK'),
    });
    const requests: URL[] = [];
    server.use(
      serveDatesBy(
        (q) =>
          q.get('origins') === 'LHR'
            ? { origins: ['LHR'], pairs: { [at('2027-03-14', 10)]: pricedPair(priced(33_000), {}, 2) } }
            : { pairs: { [at('2027-03-14', 10)]: pricedPair(lgw) } },
        requests,
      ),
    );
    const { user } = renderDates();
    expect(calendarRows(await findLower())[0]).toHaveTextContent('£290');
    await user.selectOptions(within(row()).getByRole('combobox', { name: P.from }), 'LHR');
    await waitFor(() => expect(queryOf(requests.at(-1))).toEqual({ origins: 'LHR' }));
    await waitFor(async () => expect(calendarRows(await findLower())[0]).toHaveTextContent('£330'));
    expect(calendarRows(await findLower())[0]).toHaveTextContent('LHR → JFK');
  });

  it('a journey limit applied from elsewhere shows as a chip that removes it', async () => {
    const { user, requests } = renderDates({
      body: workedDates({ maxJourneyMinutes: 1200 }),
      search: '?view=dates&def=def-0001&d.journey=1200',
    });
    await findTrips();
    expect(queryOf(requests[0])).toEqual({ maxJourneyMinutes: '1200' });
    const chip = within(row()).getByRole('button', { name: 'Remove the filter each way under 20h' });
    expect(chip).toHaveTextContent('Each way under 20h');
    await user.click(chip);
    expect(url().get('d.journey')).toBeNull();
    await waitFor(() => expect(queryOf(requests.at(-1))).toEqual({}));
    expect(within(row()).queryByRole('button', { name: /^Remove the filter/ })).toBeNull();
  });

  it('back and forward set the typed stay from the URL, half-typed text included', async () => {
    const { user } = renderDates({ body: workedDates() });
    await findTrips();
    act(() => updateSearchParams({ 'd.nights': '11-12' }, 'push'));
    expect([stay('min'), stay('max')].map((f) => (f instanceof HTMLInputElement ? f.value : null))).toEqual([
      '11',
      '12',
    ]);
    // half-typed text the filter can't apply yet (11 to 5) is replaced too, never left beside another filter
    await user.clear(stay('max'));
    await user.type(stay('max'), '5');
    expect(url().get('d.nights')).toBe('11-12');
    const popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
    act(() => window.history.back());
    await act(() => popped);
    expect(url().get('d.nights')).toBeNull();
    expect([stay('min'), stay('max')].map((f) => (f instanceof HTMLInputElement ? f.value : null))).toEqual([
      '',
      '',
    ]);
  });

  it('typing a stay keeps the text as typed while the URL follows it', async () => {
    const { user } = renderDates({ body: workedDates() });
    await findTrips();
    await user.type(stay('min'), '011');
    await user.type(stay('max'), '12');
    expect(url().get('d.nights')).toBe('11-12');
    expect(stay('min')).toHaveValue('011');
  });

  it("the empty state's Clear filters empties the typed stay too", async () => {
    const { user } = renderDates({
      body: { destinations: ['JFK'] },
      search: '?view=dates&def=def-0001&d.to=JFK&d.nights=10-10',
    });
    const trips = await findTrips();
    expect(stay('min')).toHaveValue('10');
    await user.click(within(trips).getByRole('button', { name: COPY.clearFilters }));
    expect([url().get('d.nights'), url().get('d.to')]).toEqual([null, null]);
    expect(stay('min')).toHaveValue('');
    expect(stay('max')).toHaveValue('');
  });
});

describe('the read (spec §10, §11; WP19 §6)', () => {
  it('sends origins, destinations and maxJourneyMinutes from the state, and nothing for the stay or the week switch', async () => {
    const { requests } = renderDates({
      body: workedDates({ origins: ['LHR'], destinations: ['JFK'], maxJourneyMinutes: 900 }),
      search: '?view=dates&def=def-0001&d.from=LHR&d.to=JFK&d.journey=900&d.nights=10-12&d.week=best',
    });
    await findTrips();
    expect(requests).toHaveLength(1);
    expect(queryOf(requests[0])).toEqual({ origins: 'LHR', destinations: 'JFK', maxJourneyMinutes: '900' });
    expect(requests[0]?.pathname).toBe('/api/definitions/def-0001/date-pairs');
  });

  it('changing To issues a new request, and until it answers the page shows the loading state, never the previous figures; the row stays mounted with focus on the control that changed', async () => {
    const held = heldDates();
    server.use(held.handler);
    const { user } = renderDates();
    await held.arrived();
    held.release({ pairs: { [at('2027-03-14', 10)]: pricedPair(priced(30_000)) } });
    expect(await findLower()).toHaveTextContent('£300');
    const to = within(row()).getByRole('combobox', { name: P.to });
    await user.selectOptions(to, 'JFK');
    await held.arrived();
    expect(queryOf(held.requests[1])).toEqual({ destinations: 'JFK' });
    expect(screen.queryByRole('region', { name: P.lowerHeading })).toBeNull();
    expect(document.body.textContent).not.toContain('£300');
    expect(screen.getByText(COPY.datesView.loadingFiltered)).toHaveAttribute('role', 'status');
    expect(row()).toBeInTheDocument();
    expect(document.activeElement).toBe(to);
    held.release({
      destinations: ['JFK'],
      pairs: { [at('2027-03-15', 10)]: pricedPair(priced(31_000), {}, 2) },
    });
    expect(await findLower()).toHaveTextContent('£310');
    expect(document.body.textContent).not.toContain('£300');
  });
});

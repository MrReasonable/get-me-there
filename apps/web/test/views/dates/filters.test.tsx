import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { at, priced, pricedPair, workedDates } from '../../fixtures.dates.js';
import { heldDates } from '../../msw/datesHandlers.js';
import { server } from '../../msw/server.js';
import { settled } from '../../render.js';
import { boardRows, findBoard, renderDates } from './render.js';

// Spec §11 Dates "Filters" and §9's honesty rule for the web: a filtered read is never shown with the previous
// (unfiltered) read's figures, the stay range and the week switch never reach the route, and every control is
// labelled and keyboard-operable.

const url = () => new URLSearchParams(window.location.search);
const queryOf = (u: URL | undefined) => Object.fromEntries(u?.searchParams ?? []);

describe('the filters (spec §11)', () => {
  it('every control has an accessible label', async () => {
    renderDates({ body: workedDates() });
    await findBoard();
    const form = screen.getByRole('form', { name: 'Filters' });
    for (const name of ['Stay from (nights)', 'Stay to (nights)', 'Max journey time (minutes)'])
      expect(within(form).getByRole('textbox', { name })).toBeInTheDocument();
    const origins = within(form).getByRole('group', { name: 'Origins' });
    expect(
      within(origins)
        .getAllByRole('checkbox')
        .map((c) => c.closest('label')?.textContent),
    ).toEqual(['LHR', 'LGW']);
    const destinations = within(form).getByRole('group', { name: 'Destinations' });
    expect(within(destinations).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(form).getByRole('checkbox', { name: 'Best per departure week' })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('is operable by keyboard: the week switch by Space, an airport by Space, the journey limit by Enter', async () => {
    const { user, requests } = renderDates({ body: workedDates() });
    await findBoard();
    screen.getByRole('checkbox', { name: 'Best per departure week' }).focus();
    await user.keyboard(' ');
    expect(url().get('d.week')).toBe('best');
    screen.getByRole('checkbox', { name: 'EWR' }).focus();
    await user.keyboard(' ');
    expect(url().get('d.to')).toBe('JFK');
    await user.click(screen.getByRole('textbox', { name: 'Max journey time (minutes)' }));
    await user.keyboard('900{Enter}');
    expect(url().get('d.journey')).toBe('900');
    await waitFor(() =>
      expect(queryOf(requests.at(-1))).toEqual({ destinations: 'JFK', maxJourneyMinutes: '900' }),
    );
  });

  it('a stay range applies in the browser, with no request, and ranks over the filtered date pairs', async () => {
    const { user, requests, client } = renderDates({ body: workedDates() });
    const table = await findBoard();
    await user.type(screen.getByRole('textbox', { name: 'Stay from (nights)' }), '11');
    await user.type(screen.getByRole('textbox', { name: 'Stay to (nights)' }), '12');
    expect(url().get('d.nights')).toBe('11-12');
    expect(
      boardRows(table).every((r) => /^1[12]$/.test(r.querySelectorAll('td')[3]?.textContent ?? '')),
    ).toBe(true);
    await settled(client);
    expect(requests).toHaveLength(1);
  });

  it('a reversed stay range is explained beside the fields and not applied', async () => {
    const { user } = renderDates({ body: workedDates() });
    await findBoard();
    await user.type(screen.getByRole('textbox', { name: 'Stay from (nights)' }), '12');
    await user.type(screen.getByRole('textbox', { name: 'Stay to (nights)' }), '10');
    expect(screen.getByRole('textbox', { name: 'Stay to (nights)' })).toHaveAccessibleDescription(
      'a stay range is two whole numbers, the first no larger than the second',
    );
    expect(url().get('d.nights')).toBeNull();
  });

  it('a journey limit outside 60..6000 is explained in words beside the field and not sent', async () => {
    const { user, requests, client } = renderDates({ body: workedDates() });
    await findBoard();
    const field = screen.getByRole('textbox', { name: 'Max journey time (minutes)' });
    expect(field).toHaveAccessibleDescription('between 60 and 6000 minutes');
    for (const bad of ['59', '6001', '600.5', 'ten']) {
      await user.clear(field);
      await user.type(field, `${bad}{Enter}`);
      expect(field, bad).toHaveAttribute('aria-invalid', 'true');
      expect(url().get('d.journey'), bad).toBeNull();
    }
    await settled(client);
    expect(requests).toHaveLength(1);
  });

  it('"Clear filters" resets the stay range, airports, journey limit and the week switch, and keeps the sort', async () => {
    const { user } = renderDates({
      body: workedDates(),
      search:
        '?view=dates&def=def-0001&d.nights=10-11&d.from=LHR&d.journey=900&d.week=best&d.sort=nights.asc',
    });
    await findBoard();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(Object.fromEntries(url())).toEqual({ view: 'dates', def: 'def-0001', 'd.sort': 'nights.asc' });
    expect(screen.getByRole('textbox', { name: 'Stay from (nights)' })).toHaveValue('');
  });
});

describe('the read (spec §10, §11; WP19 §6)', () => {
  it('sends origins, destinations and maxJourneyMinutes from the state, and nothing for the stay range or the week switch', async () => {
    const { requests } = renderDates({
      body: workedDates({ origins: ['LHR'], destinations: ['JFK'], maxJourneyMinutes: 900 }),
      search: '?view=dates&def=def-0001&d.from=LHR&d.to=JFK&d.journey=900&d.nights=10-12&d.week=best',
    });
    await findBoard();
    expect(requests).toHaveLength(1);
    expect(queryOf(requests[0])).toEqual({ origins: 'LHR', destinations: 'JFK', maxJourneyMinutes: '900' });
    expect(requests[0]?.pathname).toBe('/api/definitions/def-0001/date-pairs');
  });

  it('changing d.to issues a new request, and until it answers the board shows the loading state, never the previous figures; the filters stay mounted with focus on the control that changed', async () => {
    const held = heldDates();
    server.use(held.handler);
    const { user } = renderDates();
    await held.arrived();
    held.release({ pairs: { [at('2027-03-14', 10)]: pricedPair(priced(30_000)) } });
    const table = await findBoard();
    expect(table).toHaveTextContent('£300');
    const ewr = screen.getByRole('checkbox', { name: 'EWR' });
    await user.click(ewr);
    await held.arrived();
    expect(queryOf(held.requests[1])).toEqual({ destinations: 'JFK' });
    expect(screen.queryByRole('table', { name: /^Best dates/ })).toBeNull();
    expect(document.body.textContent).not.toContain('£300');
    expect(screen.getByText('Loading dates for these filters')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('form', { name: 'Filters' })).toBeInTheDocument();
    expect(document.activeElement).toBe(ewr);
    held.release({
      destinations: ['JFK'],
      pairs: { [at('2027-03-15', 10)]: pricedPair(priced(31_000), {}, 2) },
    });
    expect(await findBoard()).toHaveTextContent('£310');
    expect(document.body.textContent).not.toContain('£300');
  });
});

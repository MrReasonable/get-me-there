import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { asIsoDate } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { at, DATES_SPACE, type DatesOptions, priced, pricedPair, workedDates } from '../../fixtures.dates.js';
import { definition } from '../../fixtures.js';
import { flightPair } from '../../fixtures.searches.js';
import { serveFlightLists } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { setViewportWidth } from '../../viewport.js';
import { dayButton, findCalendar, findDayPanel, renderDates } from './render.js';

// Ruling 18 (Task 9) and spec §11 Accessibility: the calendar is one tab stop with a roving tabindex; the arrow, page
// and home/end keys move between days; Enter opens the day panel with focus on its heading and Escape returns it to the
// day; focus is always visible; Tab reaches the page's controls in their reading order.

const focused = () => document.activeElement?.getAttribute('data-day') ?? null;
const stops = () =>
  [...document.querySelectorAll('button[data-day]')].filter((c) => c.getAttribute('tabindex') === '0');

async function focusCalendar(o: DatesOptions = workedDates()) {
  const r = renderDates({ body: o });
  await findCalendar();
  const first = stops()[0];
  if (!(first instanceof HTMLElement)) throw new Error('no tab stop');
  first.focus();
  return r;
}

describe('the calendar’s keyboard (Ruling 18)', () => {
  it('is one tab stop, the first day until another is focused, then that one', async () => {
    const { user } = await focusCalendar();
    expect(stops()).toHaveLength(1);
    expect(focused()).toBe('2027-03-14');
    await user.keyboard('{ArrowRight}');
    expect(stops().map((s) => s.getAttribute('data-day'))).toEqual(['2027-03-15']);
    expect(focused()).toBe('2027-03-15');
  });

  it('Left and Right go a day, across a month end; the window’s ends hold focus', async () => {
    const { user } = await focusCalendar();
    await user.keyboard('{ArrowLeft}');
    expect(focused()).toBe('2027-03-14'); // 13 Mar is before the window
    dayButton('2027-03-31').focus();
    await user.keyboard('{ArrowRight}');
    expect(focused()).toBe('2027-04-01');
    dayButton('2027-04-13').focus();
    await user.keyboard('{ArrowRight}');
    expect(focused()).toBe('2027-04-13');
  });

  it('Up and Down move a week; Home and End go to the week’s ends inside the window', async () => {
    const { user } = await focusCalendar();
    await user.keyboard('{ArrowDown}');
    expect(focused()).toBe('2027-03-21');
    await user.keyboard('{ArrowUp}');
    expect(focused()).toBe('2027-03-14');
    dayButton('2027-03-17').focus();
    await user.keyboard('{End}');
    expect(focused()).toBe('2027-03-21'); // Sunday ends the week (Monday first)
    await user.keyboard('{Home}');
    expect(focused()).toBe('2027-03-15');
  });

  it('PageUp and PageDown move a month, clamped, and focus stays put outside the window', async () => {
    const { user } = await focusCalendar({
      space: { ...DATES_SPACE, departureTo: asIsoDate('2027-05-20') },
      pairs: { [at('2027-03-14', 10)]: pricedPair(priced(30_000)) },
    });
    await user.keyboard('{PageUp}');
    expect(focused()).toBe('2027-03-14'); // 14 Feb is before the window
    dayButton('2027-03-31').focus();
    await user.keyboard('{PageDown}');
    expect(focused()).toBe('2027-04-30');
    await user.keyboard('{PageDown}');
    expect(focused()).toBe('2027-04-30'); // 30 May is after the window
    await user.keyboard('{PageUp}');
    expect(focused()).toBe('2027-03-30');
  });

  // ported from the Calendar's grid test (review ui M7, WP19 Task 19.8): on a phone one month is drawn, so a key that
  // leaves it turns the calendar to the month it lands in, and focus follows
  it('at phone width a key that leaves the drawn month shows the month it lands in', async () => {
    setViewportWidth(375);
    const { user } = renderDates({ body: workedDates() });
    await findCalendar();
    const months = () => [
      ...new Set(
        [...document.querySelectorAll<HTMLElement>('button[data-day]')].map((c) =>
          c.dataset.day?.slice(0, 7),
        ),
      ),
    ];
    expect(months()).toEqual(['2027-03']);
    dayButton('2027-03-31').focus();
    await user.keyboard('{ArrowRight}');
    expect(months()).toEqual(['2027-04']);
    expect(focused()).toBe('2027-04-01');
    await user.keyboard('{ArrowLeft}');
    expect(months()).toEqual(['2027-03']);
    expect(focused()).toBe('2027-03-31');
  });

  it('Enter opens the day panel with focus on its heading; Escape returns focus to the day', async () => {
    const { user } = await focusCalendar();
    await user.keyboard('{ArrowRight}{Enter}');
    const panel = await findDayPanel('Mon 15 Mar: 3 stays');
    expect(within(panel).getByRole('heading')).toHaveFocus();
    // the URL stays on the search's page: a day opens its panel, never the Trip page
    expect(new URLSearchParams(window.location.search).get('view')).toBe('dates');
    await user.keyboard('{Escape}');
    expect(focused()).toBe('2027-03-15');
    expect(stops().map((s) => s.getAttribute('data-day'))).toEqual(['2027-03-15']);
  });

  it('Space opens it too (a day is a real button)', async () => {
    const { user } = await focusCalendar();
    await user.keyboard(' ');
    expect(await findDayPanel('Sun 14 Mar: 3 stays')).toBeInTheDocument();
  });

  // why: jsdom computes no focus ring; the rule that draws it is the calendar's stylesheet's
  it('focus is always visible: the stylesheet draws a solid ring on a focused day', () => {
    const css = readFileSync(resolve(__dirname, '../../../src/views/Dates/dates.css'), 'utf8');
    expect(css).toMatch(/\.cal-day:focus-visible\s*\{[^}]*outline: 2px solid var\(--t-focus\)/);
  });
});

describe('Tab order across the page (spec §11 Accessibility; mockup 02)', () => {
  it("the crumbs, the actions, the run line's link, the filter row, the trips, the lower dates, the calendar's one stop, then the first fold's summary", async () => {
    const { user } = renderDates({
      body: {
        ...workedDates(),
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(priced(41_200, { basis: 'verified' })),
          [at('2027-03-15', 10)]: pricedPair(priced(30_000)),
        },
      },
    });
    await findCalendar();
    await screen.findByTestId('dates-run');
    const seen: string[] = [];
    document.body.focus();
    for (let i = 0; i < 60; i += 1) {
      await user.tab();
      const el = document.activeElement;
      if (el === null || el === document.body) break;
      const labelled = el instanceof HTMLInputElement ? (el.labels?.[0]?.textContent ?? null) : null;
      seen.push(
        el.getAttribute('data-day') !== null
          ? 'calendar'
          : (el.getAttribute('aria-label') ?? labelled ?? el.textContent ?? ''),
      );
      if (el.matches('.sfold > summary')) break;
    }
    const index = (label: string | RegExp) =>
      seen.findIndex((s) => (typeof label === 'string' ? s === label : label.test(s)));
    const order = [
      index('Trips'),
      index('Search again'),
      index('Edit'),
      index('what was searched'),
      index('Shortest stay'),
      index('One per week'),
      // the synthetic trip's price is no link (spec §5.5): its label is the row's first stop
      index(/^Google price · /),
      index(/^Details for /),
      index(/^Calendar · /),
      index('See all on the calendar'),
      index('calendar'),
      // why: Ruling 19: the folds are closed, so the tab stop after the calendar is the first fold's summary (jsdom
      // keeps a closed row's links in the order; the browsers skip them, which the layout checks measure)
      index(/^Price over time/),
    ];
    expect(
      order.every((i) => i >= 0),
      JSON.stringify(seen),
    ).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(seen.filter((s) => s === 'calendar')).toHaveLength(1);
  });
});

// Ruling 20: a calendar row's "Read flights" is a real button, in the tab order after its label.
describe('a calendar row’s Read flights button', () => {
  async function renderOne() {
    server.use(serveFlightLists((d, r) => flightPair(d, r), { pagesPlanned: 2 }));
    const r = renderDates({
      def: definition({ origins: ['LHR'], destinations: ['JFK'] }),
      body: {
        origins: ['LHR'],
        destinations: ['JFK'],
        discoveryProviders: ['travelpayouts', 'camoufox'],
        pairs: { [at('2027-03-14', 10)]: pricedPair(priced(90_000), {}, 1) },
      },
    });
    await findCalendar();
    const button = await screen.findByRole('button', { name: /^Read flights for/ });
    return { ...r, button };
  }

  it('is a real button in the tab order, after the row’s label', async () => {
    const { user, button } = await renderOne();
    const label = screen.getByTestId('price-label').querySelector('summary');
    if (!(label instanceof HTMLElement)) throw new Error('the row has its label');
    label.focus();
    await user.tab();
    expect(button).toHaveFocus();
    expect(button.tagName).toBe('BUTTON');
    expect(button).not.toHaveAttribute('tabindex', '-1');
  });

  // why: jsdom computes no focus ring; the rule that draws it is the rows' stylesheet's
  it('carries a visible focus ring: the rows draw it on :focus-visible', async () => {
    const css = readFileSync(resolve(__dirname, '../../../src/components/rows/rows.css'), 'utf8');
    expect(css).toMatch(/\.trip-row :is\(a, button\):focus-visible\s*\{[^}]*outline: 2px solid/);
    const { button } = await renderOne();
    expect(button.className).not.toMatch(/outline-none|focus:outline-0/);
  });
});

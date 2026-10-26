import { asIsoDate } from '@gmt/core';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CELL_FOCUS } from '../../../src/views/Dates/OverviewMonth.js';
import { at, DATES_SPACE, type DatesOptions, priced, pricedPair, workedDates } from '../../fixtures.dates.js';
import { findBoard, renderDates } from './render.js';

// Spec §11 Overview "Keyboard" and Accessibility: the overview is one tab stop with a roving tabindex, the arrow,
// page and home/end keys move through it, Enter opens the detail (or a closed band), focus is always visible, and Tab
// reaches the view's controls in their reading order.

const focused = () => document.activeElement?.getAttribute('data-cell') ?? null;
const url = () => new URLSearchParams(window.location.search);
const stops = () =>
  [...document.querySelectorAll('[data-cell]')].filter((c) => c.getAttribute('tabindex') === '0');

async function focusOverview(o: DatesOptions = workedDates()) {
  const r = renderDates({ body: o });
  await findBoard();
  const first = stops()[0];
  if (!(first instanceof HTMLElement)) throw new Error('no tab stop');
  first.focus();
  return r;
}

describe('the overview’s keyboard (spec §11)', () => {
  it('is one tab stop, the first cell until another is focused, then that one', async () => {
    const { user } = await focusOverview();
    expect(stops()).toHaveLength(1);
    expect(focused()).toBe('2027-03-14|10');
    await user.keyboard('{ArrowRight}');
    expect(stops().map((s) => s.getAttribute('data-cell'))).toEqual(['2027-03-14|11']);
  });

  it('Left and Right go by reading order: the day’s stays, then the next day, across a month end', async () => {
    const { user } = await focusOverview();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(focused()).toBe('2027-03-15|10');
    await user.keyboard('{ArrowLeft}');
    expect(focused()).toBe('2027-03-14|12');
    document.querySelector<HTMLElement>('[data-cell="2027-03-31|12"]')?.focus();
    await user.keyboard('{ArrowRight}');
    expect(focused()).toBe('2027-04-01|10');
  });

  it('Up and Down move a week at the same stay; Home and End go to the day’s ends', async () => {
    const { user } = await focusOverview();
    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(focused()).toBe('2027-03-21|11');
    await user.keyboard('{ArrowUp}');
    expect(focused()).toBe('2027-03-14|11');
    await user.keyboard('{End}');
    expect(focused()).toBe('2027-03-14|12');
    await user.keyboard('{Home}');
    expect(focused()).toBe('2027-03-14|10');
  });

  it('PageUp and PageDown move a month at the same stay, clamped, and focus stays put outside the window', async () => {
    const { user } = await focusOverview({
      space: { ...DATES_SPACE, departureTo: asIsoDate('2027-05-20') },
      pairs: { [at('2027-03-14', 10)]: pricedPair(priced(30_000)) },
    });
    await user.keyboard('{PageUp}');
    expect(focused()).toBe('2027-03-14|10'); // 14 Feb is before the window
    document.querySelector<HTMLElement>('[data-cell="2027-03-31|11"]')?.focus();
    await user.keyboard('{PageDown}');
    expect(focused()).toBe('2027-04-30|11');
    await user.keyboard('{PageDown}');
    expect(focused()).toBe('2027-04-30|11'); // 30 May is after the window
    await user.keyboard('{PageUp}');
    expect(focused()).toBe('2027-03-30|11');
  });

  it('Enter on a cell opens the detail with the date pair in the URL', async () => {
    const { user } = await focusOverview();
    await user.keyboard('{ArrowRight}{Enter}');
    expect([url().get('view'), url().get('depart'), url().get('return')]).toEqual([
      'results',
      '2027-03-14',
      '2027-03-25',
    ]);
  });

  it('Enter on a closed band opens the band; the arrows then walk its stays', async () => {
    const wide: DatesOptions = {
      space: { ...DATES_SPACE, maxNights: 22 },
      pairs: { [at('2027-03-14', 13)]: pricedPair(priced(30_000)) },
    };
    const { user } = await focusOverview(wide);
    await user.keyboard('{ArrowRight}{Enter}');
    expect(url().get('view')).toBe('dates');
    expect(document.querySelector('[data-cell="2027-03-14|13"]')).not.toBeNull();
    expect(focused()).toBe('2027-03-14|12');
    await user.keyboard('{ArrowRight}');
    expect(focused()).toBe('2027-03-14|13');
  });

  it('focus is always visible: every cell carries a solid outline on focus', async () => {
    await focusOverview();
    expect(CELL_FOCUS).toContain('focus-visible:outline-solid');
    expect(CELL_FOCUS).toContain('focus-visible:outline-2');
    for (const c of document.querySelectorAll('[data-cell]')) expect(c.className).toContain(CELL_FOCUS);
  });
});

describe('Tab order across the view (spec §11 Accessibility)', () => {
  it('filters, the board’s sort buttons, each row’s link, Show 10 more, the overview’s one stop, then the coverage toggle', async () => {
    const { user } = renderDates({ body: workedDates() });
    await findBoard();
    const seen: string[] = [];
    document.body.focus();
    for (let i = 0; i < 40; i += 1) {
      await user.tab();
      const el = document.activeElement;
      if (el === null || el === document.body) break;
      seen.push(
        el.getAttribute('data-cell') !== null
          ? 'overview'
          : (el.getAttribute('aria-label') ?? el.textContent ?? ''),
      );
      if (el.textContent === 'Coverage of the latest run') break;
    }
    const index = (label: string | RegExp) =>
      seen.findIndex((s) => (typeof label === 'string' ? s === label : label.test(s)));
    const order = [
      index(/^discovery: /),
      index('Clear filters'),
      index('Depart'),
      index('Journey time'),
      index(/^Open 14 Mar 2027/),
      index('Show 1 more'),
      index('overview'),
      index('Coverage of the latest run'),
    ];
    expect(
      order.every((i) => i >= 0),
      JSON.stringify(seen),
    ).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(seen.filter((s) => s === 'overview')).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: /^Open \d/ })).toHaveLength(10);
  });
});

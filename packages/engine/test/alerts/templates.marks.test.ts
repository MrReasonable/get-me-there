import { asIsoDateTime, BANNED_WORD_ALLOWLIST, findBannedWords, TRUNCATED_NOTE } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { type ItemMarks, NO_MARKS, renderBody } from '../../src/alerts/templates.js';
import { calendarItem, digestOf, HASH, renderInput, verifiedItem } from './builders.js';

const marks = (over: Partial<ItemMarks>): ItemMarks => ({ ...NO_MARKS, ...over });

describe('marks the runner reads from the repositories (spec §3, §8.1; decisions 25, 30, 54, 55, 59)', () => {
  it('not seen in latest search, stale, cheapest of the rows read; the unconfirmed and budget lines', () => {
    const body = renderBody(
      renderInput({
        digest: digestOf([verifiedItem(), calendarItem()], {
          newItems: [calendarItem({ isNew: true, rowKey: 'calendar:6' })],
        }),
        marks: new Map([
          [HASH, marks({ notSeenInLatest: { at: asIsoDateTime('2026-10-14T12:00:00.000Z') } })],
          ['calendar:5', marks({ stale: { thresholdHours: 192 }, truncated: true })],
          ['calendar:6', marks({ truncated: true })],
        ]),
        unconfirmed: 2,
        budgetStop: { unsearched: 1 },
      }),
    );
    expect(body).toContain('   Notes: not seen in latest search (3h ago)');
    expect(body).toContain(`   Notes: ${TRUNCATED_NOTE}; stale: older than 192h`);
    expect(body).toContain(`(≤7d before that) · ${TRUNCATED_NOTE}`);
    expect(body).toContain(
      'Unconfirmed: 2 fares in this run had no price confirmed by the final step; they are never alerted.',
    );
    expect(body).toContain(
      'Not searched: a budget cap left 1 cell search of this run undone; the prices above come from the cells that were searched.',
    );
  });

  it('a newer search with no recorded instant reads "not seen in latest search" with no age (review PA-6)', () => {
    const body = renderBody(
      renderInput({ marks: new Map([[HASH, marks({ notSeenInLatest: { at: null } })]]) }),
    );
    expect(body).toContain('   Notes: not seen in latest search\n');
  });

  it('a converted previous price carries "≈" in the item and in the "new" section (decision 59)', () => {
    const body = renderBody(
      renderInput({
        digest: digestOf([calendarItem({ previousPricePence: 43000, fetchGapHours: 72 })], {
          basis: 'calendar',
          newItems: [
            calendarItem({
              isNew: true,
              rowKey: 'calendar:6',
              previousPricePence: 50000,
              fetchGapHours: 169,
            }),
          ],
        }),
        marks: new Map([
          ['calendar:5', marks({ previousConverted: true })],
          ['calendar:6', marks({ previousConverted: true })],
        ]),
      }),
    );
    expect(body).toContain('   Previous: ≈£430, fetched 3d before this price');
    expect(body).toContain(' · previous ≈£500, fetched 7d before this price');
  });
});

describe('the budget-stop lines appear only after a budget stop (decision 59; review PA2-1)', () => {
  it('a budget stop during discovery: "not run" with its cause, and the count as a lower bound', () => {
    const body = renderBody(
      renderInput({
        digest: digestOf([calendarItem()], { basis: 'calendar' }),
        budgetStop: { unsearched: 14 },
        verificationNotRun: true,
      }),
    );
    expect(body).toContain(
      'Not searched: a budget cap left at least 14 cell searches of this run undone; the prices above come from the cells that were searched.',
    );
    expect(body).toContain(
      'Coverage: itinerary search not run (a budget cap stopped the run during discovery)',
    );
    expect(body).not.toContain('itinerary-searched');
  });

  it('a budget stop with nothing left unsearched but no itinerary search says so without a count ("at least 0" never)', () => {
    const body = renderBody(
      renderInput({
        digest: digestOf([calendarItem()]),
        budgetStop: { unsearched: 0 },
        verificationNotRun: true,
      }),
    );
    expect(body).toContain(
      'Not searched: a budget cap stopped this run before its itinerary search; the prices above are calendar prices only.',
    );
    expect(body).not.toContain('at least 0');
  });

  it('no budget stop: no "Not searched" line, and an itinerary search that never ran names no cause', () => {
    const body = renderBody(renderInput({ digest: digestOf([calendarItem()]), verificationNotRun: true }));
    expect(body).not.toContain('Not searched');
    expect(body).not.toContain('budget cap');
    expect(body).toContain('Coverage: itinerary search not run\n');
  });
});

describe('banned words over the marks and run lines (spec §11)', () => {
  it('no banned word with every mark and both run lines set', () => {
    const body = renderBody(
      renderInput({
        digest: digestOf([verifiedItem(), calendarItem({ previousPricePence: 43000, fetchGapHours: 2 })]),
        marks: new Map([
          [HASH, marks({ stale: { thresholdHours: 192 }, notSeenInLatest: { at: null } })],
          ['calendar:5', marks({ stale: { thresholdHours: 216 }, truncated: true, previousConverted: true })],
        ]),
        unconfirmed: 1,
        budgetStop: { unsearched: 3 },
        verificationNotRun: true,
      }),
    );
    expect(findBannedWords(body, BANNED_WORD_ALLOWLIST)).toEqual([]);
  });
});

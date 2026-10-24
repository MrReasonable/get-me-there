// The browser window (spec §8.2 rev 36; decision 83; WP16a Task 16a.2b): the pure rule. Literal UTC instants only.
import { asIsoDateTime } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BROWSER_WINDOW_FACTOR,
  browserWindow,
  browserWindowEndFrom,
  loadsBrowserPages,
  resumeLeavesBrowserCells,
} from '../../src/scheduler/browserWindow.js';

beforeEach(() => {
  expect.hasAssertions();
});

const at = asIsoDateTime;
const END = at('2027-03-01T06:30:00.000Z');
const row = {
  browserWindowEnd: END,
  startedAt: at('2027-03-01T06:00:00.000Z'),
  createdAt: at('2027-03-01T06:00:00.000Z'),
};
const scheduled = { mode: 'scheduled', stuckAfterHours: 12 } as const;

describe('browserWindow (decision 83)', () => {
  it('under scheduled the stored end is inclusive: open at it, closed one ms later', () => {
    expect(browserWindow(row, scheduled, at('2027-03-01T06:29:59.999Z'))).toEqual({ open: true, end: END });
    expect(browserWindow(row, scheduled, END)).toEqual({ open: true, end: END });
    expect(browserWindow(row, scheduled, at('2027-03-01T06:30:00.001Z'))).toEqual({ open: false, end: END });
  });

  it('reads only the stored columns: the end wins over started_at, and STUCK_AFTER_HOURS is not consulted when it is set', () => {
    expect(
      browserWindow(row, { mode: 'scheduled', stuckAfterHours: 1000 }, at('2027-03-01T07:00:00.000Z')).open,
    ).toBe(false);
  });

  it('under any the window is unbounded', () => {
    expect(browserWindow(row, { mode: 'any', stuckAfterHours: 12 }, at('2030-01-01T00:00:00.000Z'))).toEqual({
      open: true,
      end: null,
    });
  });

  it('a row with no stored end (before migration 0007, or no estimate) ends at started_at + STUCK_AFTER_HOURS, else created_at', () => {
    const old = {
      browserWindowEnd: null,
      startedAt: at('2027-03-01T06:00:00.000Z'),
      createdAt: at('2027-03-01T05:00:00.000Z'),
    };
    const end = at('2027-03-01T18:00:00.000Z');
    expect(browserWindow(old, scheduled, end)).toEqual({ open: true, end });
    expect(browserWindow(old, scheduled, at('2027-03-01T18:00:00.001Z'))).toEqual({ open: false, end });
    const pending = { ...old, startedAt: null };
    expect(browserWindow(pending, scheduled, at('2027-03-01T17:00:00.000Z'))).toEqual({
      open: true,
      end: at('2027-03-01T17:00:00.000Z'),
    });
    expect(browserWindow(pending, scheduled, at('2027-03-01T17:00:00.001Z')).open).toBe(false);
  });
});

describe('browserWindowEndFrom (decision 83: anchor + 1.5 × the estimate seconds)', () => {
  it('adds 1.5 times the seconds, rounded up to the millisecond', () => {
    expect(BROWSER_WINDOW_FACTOR).toBe(1.5);
    expect(browserWindowEndFrom(at('2027-03-01T06:00:00.000Z'), 1200)).toBe('2027-03-01T06:30:00.000Z');
    expect(browserWindowEndFrom(at('2027-03-01T06:00:00.000Z'), 0)).toBe('2027-03-01T06:00:00.000Z');
    expect(browserWindowEndFrom(at('2027-03-01T06:00:00.000Z'), 0.0005)).toBe('2027-03-01T06:00:00.001Z');
  });
});

describe('loadsBrowserPages', () => {
  it('is camoufox only', () => {
    expect(loadsBrowserPages('camoufox')).toBe(true);
    for (const id of ['travelpayouts', 'searchapi', 'fixture'] as const)
      expect(loadsBrowserPages(id)).toBe(false);
  });
});

describe('resumeLeavesBrowserCells (decisions 79, 83; review R12: the resume and View D read one rule)', () => {
  const SCHEDULED = { mode: 'scheduled', stuckAfterHours: 6 } as const;
  const row = {
    isChild: false,
    isCatchUp: false,
    browserWindowEnd: asIsoDateTime('2027-03-01T06:10:00.000Z'),
    startedAt: asIsoDateTime('2027-03-01T06:00:00.000Z'),
    createdAt: asIsoDateTime('2027-03-01T06:00:00.000Z'),
  };
  it('a parent inside its window: no; past it: yes; under any: no', () => {
    expect(resumeLeavesBrowserCells(row, SCHEDULED, asIsoDateTime('2027-03-01T06:10:00.000Z'))).toBe(false);
    expect(resumeLeavesBrowserCells(row, SCHEDULED, asIsoDateTime('2027-03-01T06:10:00.001Z'))).toBe(true);
    expect(
      resumeLeavesBrowserCells(
        row,
        { mode: 'any', stuckAfterHours: 6 },
        asIsoDateTime('2027-03-09T00:00:00.000Z'),
      ),
    ).toBe(false);
  });
  it('a catch-up always, under either setting; a child never', () => {
    const early = asIsoDateTime('2027-03-01T06:00:00.000Z');
    expect(resumeLeavesBrowserCells({ ...row, isCatchUp: true }, SCHEDULED, early)).toBe(true);
    expect(
      resumeLeavesBrowserCells({ ...row, isCatchUp: true }, { mode: 'any', stuckAfterHours: 6 }, early),
    ).toBe(true);
    expect(
      resumeLeavesBrowserCells(
        { ...row, isChild: true },
        SCHEDULED,
        asIsoDateTime('2027-03-09T00:00:00.000Z'),
      ),
    ).toBe(false);
  });
});

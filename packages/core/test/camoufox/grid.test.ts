// WP15 Task 15.5: the grid's wire contract, its dated constants, the grid label and the grid config (spec §2, §12
// rev 34; decision 70). Synthetic values only.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  GRID_GRAMMAR_VERSION,
  GRID_HORIZON_DAYS,
  GRID_SIDE,
  GRID_STEP_DAYS,
  GRID_TIMES,
} from '../../src/camoufox/grid.js';
import {
  ANSWER_STATUS,
  gridRequestSchema,
  pageRequestSchema,
  workerAnswerSchema,
  workerStatusSchema,
} from '../../src/camoufox/protocol.js';
import { parseConfig } from '../../src/config/schema.js';
import { GRID_SOURCE_LABEL, sourceLabel } from '../../src/labels/source.js';
import { returnDateSourceSchema, vendorPriceMarkSchema } from '../../src/types/provenance.js';

beforeEach(() => {
  expect.hasAssertions();
});

const AT = '2026-10-18T05:00:00.000Z';
const versions = {
  selectors: '2026-10-18-results',
  grammar: '2026-10-18-feasibility',
  camoufoxJs: '0.11.5',
  binary: '152.0.4-beta.28',
  gridGrammar: GRID_GRAMMAR_VERSION,
};
const grid = {
  mode: 'grid',
  origin: 'LHR',
  destination: 'JFK',
  gl: 'GB',
  start: { departureDate: '2027-03-14', returnDate: '2027-03-24' },
  moves: ['down', 'down'],
  reads: [true, false, true],
  scrollAllowance: 2,
};
const cell = {
  status: 'price',
  departureDate: '2027-03-11',
  returnDate: '2027-03-21',
  amountMinor: 45_700,
  mark: 'none',
};
const view = {
  index: 0,
  departures: ['2027-03-11'],
  returns: ['2027-03-21'],
  cells: [cell],
  unparsed: 0,
  structural: 'ok',
  offPlan: null,
};
const answer = {
  kind: 'grid',
  fetchedAt: AT,
  currency: 'GBP',
  pointOfSale: 'GB',
  views: [view],
  scrolls: 2,
  ended: 'complete',
  notes: [],
  versions,
};

describe('the grid constants (recordings of 2026-10-18)', () => {
  it('are the measured and dated values', () => {
    expect([GRID_SIDE, GRID_STEP_DAYS, GRID_HORIZON_DAYS, GRID_GRAMMAR_VERSION]).toEqual([
      7,
      { departures: 1, returns: 1 },
      320,
      '2026-10-18',
    ]);
    expect(GRID_TIMES).toEqual({ pageSeconds: 30, scrollSeconds: 9.3 });
  });
});

describe('gridRequestSchema', () => {
  it('accepts a grid path and is one of the page requests', () => {
    expect(gridRequestSchema.parse(grid)).toEqual(grid);
    expect(pageRequestSchema.parse(grid)).toEqual(grid);
  });
  it.each([
    ['reads of the wrong length', { ...grid, reads: [true] }],
    ['a move outside the four', { ...grid, moves: ['sideways', 'down'] }],
    ['an allowance above the moves', { ...grid, scrollAllowance: 3 }],
    [
      'a start whose return is before its departure',
      { ...grid, start: { departureDate: '2027-03-24', returnDate: '2027-03-14' } },
    ],
    ['the same airports', { ...grid, destination: 'LHR' }],
    [
      'more than 60 moves',
      { ...grid, moves: Array(61).fill('down'), reads: Array(62).fill(false), scrollAllowance: 0 },
    ],
  ])('refuses %s', (_l, bad) => {
    expect(gridRequestSchema.safeParse(bad).success).toBe(false);
  });
});

describe('the grid answer', () => {
  it('is 200 and parses with its views, scrolls and end', () => {
    expect(ANSWER_STATUS.grid).toBe(200);
    expect(workerAnswerSchema.parse(answer)).toEqual(answer);
    for (const ended of ['scroll-not-settled', 'off-plan', 'allowance', 'no-flights'])
      expect(workerAnswerSchema.safeParse({ ...answer, ended }).success).toBe(true);
  });
  it.each([
    ['a cell whose return is before its departure', { ...cell, returnDate: '2027-03-10' }],
    ['a mark outside the three', { ...cell, mark: 'great' }],
    ['a price of 0', { ...cell, amountMinor: 0 }],
    [
      'an unpriced cell (not recorded yet, PA-13)',
      { status: 'no-flights', departureDate: '2027-03-11', returnDate: '2027-03-21' },
    ],
  ])('refuses %s', (_l, bad) => {
    expect(workerAnswerSchema.safeParse({ ...answer, views: [{ ...view, cells: [bad] }] }).success).toBe(
      false,
    );
  });
  it('a same-day cell is a cell (the grid shows one); a view holds at most 49', () => {
    expect(
      workerAnswerSchema.safeParse({
        ...answer,
        views: [{ ...view, cells: [{ ...cell, returnDate: '2027-03-11' }] }],
      }).success,
    ).toBe(true);
    expect(
      workerAnswerSchema.safeParse({ ...answer, views: [{ ...view, cells: Array(50).fill(cell) }] }).success,
    ).toBe(false);
  });
  it('a stop on a grid request carries the scrolls it made (CB-4)', () => {
    expect(
      workerAnswerSchema.parse({ kind: 'blocked', page: 'captcha', cooldownUntil: AT, scrolls: 3 }),
    ).toMatchObject({ scrolls: 3 });
    expect(workerAnswerSchema.parse({ kind: 'not-ready', elapsedMs: 5, scrolls: 0 })).toMatchObject({
      scrolls: 0,
    });
  });
  it('the status reports the measured step, or null', () => {
    const status = {
      ok: true,
      coolingDownUntil: null,
      cooldownCause: null,
      signedInRefusal: false,
      lastPageAt: null,
      busySince: null,
      versions,
      flags: {},
      accountCookie: { found: false, names: [], checkedAt: AT },
      socsCapturedAt: AT,
      socsStable: true,
      cooldownHours: 48,
      pageTimeoutSeconds: 90,
      gridStepDays: { departures: 1, returns: 1 },
    };
    expect(workerStatusSchema.parse(status).gridStepDays).toEqual({ departures: 1, returns: 1 });
    expect(workerStatusSchema.parse({ ...status, gridStepDays: null }).gridStepDays).toBeNull();
  });
});

describe('provenance fields and labels', () => {
  it('names the return-date sources and the vendor marks', () => {
    expect(returnDateSourceSchema.options).toEqual(['vendor', 'asked', 'grid-cell']);
    expect(vendorPriceMarkSchema.options).toEqual(['cheapest', 'low', 'none']);
  });
  it('a grid price has its own label; a list price keeps its own', () => {
    expect(GRID_SOURCE_LABEL).toBe('Google Flights date grid via Camoufox');
    expect(sourceLabel({ sourceKind: 'scraped-self', returnDateSource: 'grid-cell' })).toBe(
      GRID_SOURCE_LABEL,
    );
    expect(sourceLabel({ sourceKind: 'scraped-self', returnDateSource: 'asked' })).toBe(
      'Google Flights prices via Camoufox',
    );
    expect(sourceLabel({ sourceKind: 'scraped-aggregate', returnDateSource: 'grid-cell' })).toBe(
      'Google date grid via SearchApi',
    );
  });
});

describe('the grid config (spec §12 rev 34)', () => {
  const ON = {
    NODE_ENV: 'production',
    DATABASE_PATH: '/data/get-me-there.db',
    APP_BASIC_AUTH_USER: 'ian',
    APP_BASIC_AUTH_PASS: 'correct-horse-battery',
    IN_CONTAINER: '1',
    CAMOUFOX_ENABLED: 'true',
    CAMOUFOX_WORKER_URL: 'http://host.docker.internal:8090',
    CAMOUFOX_WORKER_KEY: 'test-camoufox-worker-key-0123456789abcdef',
  };
  const cfg = (env: Record<string, string>) => parseConfig(env, { realpath: (p) => p });
  it('list by default, with the grid defaults stated', () => {
    const r = cfg(ON);
    expect(r.ok && r.config.providers.camoufox).toMatchObject({
      mode: 'list',
      gridScrollSpacingSeconds: 5,
      gridScrollCap: 30,
      executionScrollCap: 600,
      monthlyScrollCap: 6000,
    });
  });
  it('accepts grid and the bounds', () => {
    const r = cfg({
      ...ON,
      CAMOUFOX_MODE: 'grid',
      CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: '30',
      CAMOUFOX_GRID_SCROLL_CAP: '0',
      CAMOUFOX_EXECUTION_SCROLL_CAP: '6000',
      CAMOUFOX_MONTHLY_SCROLL_CAP: '0',
    });
    expect(r.ok && r.config.providers.camoufox).toMatchObject({
      mode: 'grid',
      gridScrollSpacingSeconds: 30,
      gridScrollCap: 0,
      executionScrollCap: 6000,
      monthlyScrollCap: 0,
    });
  });
  it.each([
    ['CAMOUFOX_GRID_SCROLL_SPACING_SECONDS', '4'],
    ['CAMOUFOX_GRID_SCROLL_SPACING_SECONDS', '31'],
    ['CAMOUFOX_GRID_SCROLL_CAP', '61'],
    ['CAMOUFOX_EXECUTION_SCROLL_CAP', '6001'],
    ['CAMOUFOX_MODE', 'calendar'],
  ])('%s=%s fails boot naming the field', (name, value) => {
    const r = cfg({ ...ON, [name]: value });
    expect(r.ok ? [] : r.errors.map((e) => e.field)).toContain(name);
  });
});

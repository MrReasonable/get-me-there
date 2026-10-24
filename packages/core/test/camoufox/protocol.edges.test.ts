// The worker wire contract at its edges (WP16a review R40, ts-b1-002): the regex anchors, the round-trip boundaries,
// and the path and words of every refinement, which the worker and the installer use to name the failing field; and
// every value of each closed list is accepted. The worked example only (London Heathrow → New York JFK).
import { beforeEach, describe, expect, it } from 'vitest';
import {
  gridCellSchema,
  gridRequestSchema,
  gridViewSchema,
  listRequestSchema,
  pageCellSchema,
  workerAnswerSchema,
} from '../../src/camoufox/protocol.js';

beforeEach(() => {
  expect.hasAssertions();
});

const NAMES = {
  origin: ['London Heathrow Airport'],
  destination: ['John F Kennedy International Airport'],
};
const LIST = {
  mode: 'list',
  origin: 'LHR',
  destination: 'JFK',
  departureDate: '2027-03-11',
  returnDate: '2027-03-21',
  gl: 'GB',
  airportNames: NAMES,
};
const GRID = {
  mode: 'grid',
  origin: 'LHR',
  destination: 'JFK',
  gl: 'GB',
  start: { departureDate: '2027-03-11', returnDate: '2027-03-21' },
  moves: ['right'],
  reads: [true, true],
  scrollAllowance: 1,
};
const VERSIONS = {
  selectors: '2026-10-18',
  grammar: '2026-10-18',
  camoufoxJs: '0.11.5',
  binary: '152.0.4-beta.28',
};
const CELLS = {
  kind: 'cells',
  fetchedAt: '2027-03-01T06:00:00.000Z',
  currency: 'GBP',
  pointOfSale: 'GB',
  cell: { status: 'no-flights' },
  notes: [],
  versions: VERSIONS,
};
const VIEW = {
  index: 0,
  departures: [],
  returns: [],
  cells: [],
  unparsed: 0,
  structural: 'ok',
  offPlan: null,
};
const GRID_ANSWER = {
  kind: 'grid',
  fetchedAt: '2027-03-01T06:00:00.000Z',
  currency: 'GBP',
  pointOfSale: 'GB',
  views: [VIEW],
  scrolls: 0,
  ended: 'complete',
  notes: [],
  versions: VERSIONS,
};

/** The first issue's path and words, or null when the value parses. */
function issue(
  r:
    | { success: true }
    | { success: false; error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> } },
) {
  if (r.success) return null;
  const [first] = r.error.issues;
  return first === undefined ? null : { path: first.path, message: first.message };
}

describe('gl and pointOfSale are exactly two capitals (or unknown, for a stated point of sale)', () => {
  it.each(['USA', 'xxUS', 'us', 'US!', 'U'])('a page request with gl %s is refused', (gl) => {
    expect(listRequestSchema.safeParse({ ...LIST, gl }).success).toBe(false);
    expect(gridRequestSchema.safeParse({ ...GRID, gl }).success).toBe(false);
  });
  it.each(['USA', 'xUS', 'us', 'unknownx', 'xunknown'])(
    'an answer stating pointOfSale %s is refused',
    (pointOfSale) => {
      expect(workerAnswerSchema.safeParse({ ...CELLS, pointOfSale }).success).toBe(false);
      expect(workerAnswerSchema.safeParse({ ...GRID_ANSWER, pointOfSale }).success).toBe(false);
    },
  );
  it('unknown and a two-capital code are accepted', () => {
    for (const pointOfSale of ['unknown', 'US']) {
      expect(workerAnswerSchema.safeParse({ ...CELLS, pointOfSale }).success).toBe(true);
      expect(workerAnswerSchema.safeParse({ ...GRID_ANSWER, pointOfSale }).success).toBe(true);
    }
    expect(listRequestSchema.safeParse({ ...LIST, gl: 'US' }).success).toBe(true);
  });
});

describe('each refinement names its field and says why', () => {
  it('a list request is one round trip between two airports', () => {
    expect(issue(listRequestSchema.safeParse({ ...LIST, returnDate: LIST.departureDate }))).toEqual({
      path: ['returnDate'],
      message: 'a page request is one cell: the return date must follow the departure date',
    });
    expect(issue(listRequestSchema.safeParse({ ...LIST, destination: 'LHR' }))).toEqual({
      path: ['destination'],
      message: 'origin and destination must differ',
    });
    expect(issue(listRequestSchema.safeParse(LIST))).toBeNull();
  });
  it('a grid request reads the first view and each move, within its allowance, from a round-trip centre', () => {
    expect(issue(gridRequestSchema.safeParse({ ...GRID, reads: [true] }))).toEqual({
      path: ['reads'],
      message: 'reads names the first view and each move',
    });
    expect(issue(gridRequestSchema.safeParse({ ...GRID, scrollAllowance: 2 }))).toEqual({
      path: ['scrollAllowance'],
      message: 'the allowance is at most the moves',
    });
    // a centre whose return is its departure is not a round trip: the boundary itself is refused
    expect(
      issue(
        gridRequestSchema.safeParse({
          ...GRID,
          start: { departureDate: '2027-03-11', returnDate: '2027-03-11' },
        }),
      ),
    ).toEqual({ path: ['start'], message: 'the first block centre is a round trip' });
    expect(issue(gridRequestSchema.safeParse({ ...GRID, destination: 'LHR' }))).toEqual({
      path: ['destination'],
      message: 'origin and destination must differ',
    });
    expect(issue(gridRequestSchema.safeParse(GRID))).toBeNull();
  });
  it('a none-for-cell answer names at least one option for another cell', () => {
    expect(
      issue(pageCellSchema.safeParse({ status: 'none-for-cell', optionsOtherCell: 0, optionsUnparsed: 2 })),
    ).toEqual({
      path: ['optionsOtherCell'],
      message: 'none-for-cell names at least one option for another cell',
    });
    expect(
      pageCellSchema.safeParse({ status: 'none-for-cell', optionsOtherCell: 1, optionsUnparsed: 0 }).success,
    ).toBe(true);
  });
  it('a grid cell returns on or after it departs (a same-day pair is shown)', () => {
    const cell = {
      status: 'price',
      departureDate: '2027-03-11',
      returnDate: '2027-03-11',
      amountMinor: 100,
      mark: 'low',
    };
    expect(gridCellSchema.safeParse(cell).success).toBe(true);
    expect(issue(gridCellSchema.safeParse({ ...cell, returnDate: '2027-03-10' }))).toEqual({
      path: ['returnDate'],
      message: 'a cell returns on or after it departs',
    });
  });
});

describe('every value of each closed list is accepted, and nothing else', () => {
  it.each(['ok', 'unparsed'])('a view whose structural is %s', (structural) => {
    expect(gridViewSchema.safeParse({ ...VIEW, structural }).success).toBe(true);
  });
  it.each(['near-today', 'sale-window-end', 'shifted', 'short-move'])('a view off plan for %s', (offPlan) => {
    expect(gridViewSchema.safeParse({ ...VIEW, offPlan }).success).toBe(true);
  });
  it.each(['launch', 'navigate', 'read'])('a browser error at %s', (stage) => {
    expect(workerAnswerSchema.safeParse({ kind: 'browser-error', stage, detail: 'x' }).success).toBe(true);
  });
  it('refuses a value none of them names', () => {
    expect(gridViewSchema.safeParse({ ...VIEW, structural: '' }).success).toBe(false);
    expect(gridViewSchema.safeParse({ ...VIEW, offPlan: '' }).success).toBe(false);
    expect(workerAnswerSchema.safeParse({ kind: 'browser-error', stage: '', detail: 'x' }).success).toBe(
      false,
    );
  });
});

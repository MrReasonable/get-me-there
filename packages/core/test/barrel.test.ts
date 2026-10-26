import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';

describe('@gmt/core barrel', () => {
  it('re-exports the WP0 contract surface', () => {
    for (const name of [
      'iataSchema',
      'asIsoDate',
      'provenanceSchema',
      'cellKeyString',
      'ACTIVE_STATUSES',
      'ProviderError',
      'BudgetExceeded',
      'AbortedError',
      'NormalisationError',
      'Secret',
      'PLAN_PRESETS',
      'parseConfig',
      'syntheticAllowed',
      'findBannedWords',
      'effectiveAge',
      'fixedClock',
      'systemClock',
    ]) {
      expect(core, name).toHaveProperty(name);
    }
    expect(core.apiContract.ROUTES.length).toBeGreaterThan(30);
  });
  it('re-exports the WP19 date-pair surface, and the contract its schemas', () => {
    for (const name of [
      'MAX_WINDOW_DAYS',
      'MAX_NIGHTS',
      'DEFAULT_MAX_CELLS',
      'MAX_DATE_PAIRS',
      'windowDays',
      'sortedAirportPairs',
      'stayCount',
      'datePairCount',
      'datePairAt',
      'datePairIndex',
      'datePairIndexer',
      'pickVerifiedFigure',
      'pickCalendarFigure',
      'pickFigure',
      'figuresByDatePair',
      'encodeDatePairs',
      'decodeDatePairs',
      'provenanceKey',
      'rankDatePairs',
      'bestPerWeek',
      'MAX_NIGHT_BANDS',
      'foldNights',
      'DETAIL_LINK_PARAMS',
      'detailLinkQuery',
    ]) {
      expect(core, name).toHaveProperty(name);
    }
    for (const name of [
      'datePairsQuerySchema',
      'datePairsResponseSchema',
      'datePairFigureSchema',
      'DEFAULT_MAX_CELLS',
      'MAX_DATE_PAIRS',
      'MIN_JOURNEY_LIMIT_MINUTES',
      'MAX_JOURNEY_LIMIT_MINUTES',
    ]) {
      expect(core.apiContract, name).toHaveProperty(name);
    }
    // why: columnAt is the decoder's own guard, not part of the package's surface
    expect(core).not.toHaveProperty('columnAt');
  });
});

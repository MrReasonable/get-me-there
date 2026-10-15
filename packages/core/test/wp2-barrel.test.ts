import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';

// The WP2 public surface: the plan's "Core domain functions (WP2)" block plus its named constants.
// why: named exports, not `export *`, so module-internal helpers stay private; this test pins both lists.
const WP2 = [
  'canonicalCarrier',
  'canonicalFlightNumber',
  'departLocal',
  'toIsoDateTime',
  'itineraryHash',
  'MINOR_EXPONENT',
  'ECB_CURRENCIES',
  'toGbp',
  'LINK_ALLOWLIST',
  'SEARCH_LINK_LABEL',
  'validateVendorUrl',
  'searchLinkFor',
  'normaliseOffer',
  'evaluateConstraints',
  'verdictClass',
  'unverifiedNames',
  'dedupByItinerary',
  'rankRows',
  'sortRows',
  'filterRows',
  'bandCheapest',
  'resultRowKey',
  'formatPence',
  'CONSTRAINT_LABELS',
  'evaluateAlertRules',
  'identityKey',
  'dedupKey',
  'isSuppressed',
  'buildDigest',
  'hasControlChars',
  'stripControlChars',
  'MIN_REPEAT_DROP_PENCE',
  'MIN_REPEAT_DROP_PERCENT',
  'MAX_URL_LENGTH',
  'MAX_POST_DATA_LENGTH',
];
const PRIVATE = [
  'wallToInstant',
  'vendorInstant',
  'parseVendorTime',
  'localMinute',
  'requireZone',
  'hoursSince',
  'priceOf',
  'need',
  'compareRows',
  'compareText',
  'CONSTRAINT_NAMES',
];

describe('@gmt/core barrel, WP2 exports', () => {
  it.each(WP2)('exports %s', (name) => {
    expect(core).toHaveProperty(name);
  });
  it.each(PRIVATE)('keeps %s private', (name) => {
    expect(core).not.toHaveProperty(name);
  });
});

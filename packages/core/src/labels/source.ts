import type { Provenance, SourceKind } from '../types/provenance.js';

/**
 * Spec §11 vocabulary, the one copy (decision 56): the source of a price in words. Each source kind belongs to one
 * provider (spec §2), so the kind alone names it. The engine's email templates and WP9's PriceCell both read it.
 */
export const SOURCE_LABELS: Readonly<Record<SourceKind, string>> = {
  'authorised-cached': 'Aviasales cache',
  'scraped-aggregate': 'Google date grid via SearchApi',
  'scraped-search': 'Google Flights via SearchApi',
  'scraped-self': 'Google Flights prices via Camoufox',
  synthetic: 'synthetic fixture data',
};

/** A camoufox grid price's source (spec §2 rev 34): the same source kind, read from Google's date grid. */
export const GRID_SOURCE_LABEL = 'Google Flights date grid via Camoufox';

/**
 * The source of a price in words, e.g. "Google Flights via SearchApi" (spec §11); a camoufox price whose return date
 * came from a grid cell is the grid's.
 */
export function sourceLabel(p: {
  sourceKind: Provenance['sourceKind'];
  returnDateSource?: Provenance['returnDateSource'] | undefined;
}): string {
  if (p.sourceKind === 'scraped-self' && p.returnDateSource === 'grid-cell') return GRID_SOURCE_LABEL;
  return SOURCE_LABELS[p.sourceKind];
}

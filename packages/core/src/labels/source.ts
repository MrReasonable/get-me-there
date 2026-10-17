import type { Provenance, SourceKind } from '../types/provenance.js';

/**
 * Spec §11 vocabulary, the one copy (decision 56): the source of a price in words. Each source kind belongs to one
 * provider (spec §2), so the kind alone names it. The engine's email templates and WP9's PriceCell both read it.
 */
export const SOURCE_LABELS: Readonly<Record<SourceKind, string>> = {
  'authorised-cached': 'Aviasales cache',
  'scraped-aggregate': 'Google date grid via SearchApi',
  'scraped-search': 'Google Flights via SearchApi',
  synthetic: 'synthetic fixture data',
};

/** The source of a price in words, e.g. "Google Flights via SearchApi" (spec §11). */
export function sourceLabel(p: Pick<Provenance, 'sourceKind'>): string {
  return SOURCE_LABELS[p.sourceKind];
}

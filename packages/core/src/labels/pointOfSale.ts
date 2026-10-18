import type { Provenance } from '../types/provenance.js';

/**
 * Spec §11 vocabulary, the one copy: the market a price was quoted in, in words. "GB" is the UK market (what the
 * operator is checking for); "unknown" is a vendor that ignores the setting and says so; any other ISO country code
 * is named by the code. The web's full price displays and the alert email's provenance line both read it.
 */
export function pointOfSaleLabel(p: Pick<Provenance, 'pointOfSale'>): string {
  if (p.pointOfSale === 'GB') return 'UK market';
  if (p.pointOfSale === 'unknown') return 'market not stated';
  return `${p.pointOfSale} market`;
}

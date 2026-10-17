/** Vendor links re-validated on the way out (spec §5.2, plan decision 54). */
import {
  type Booking,
  type CellKey,
  LINK_ALLOWLIST,
  type ProviderId,
  SEARCH_LINK_ROW_LABEL,
  type SearchDefinition,
  searchLinkFor,
  validateVendorUrl,
} from '@gmt/core';
import type { ResultRow } from './rows.js';

/**
 * Spec §5.2 and plan decision 54: a stored booking is re-validated against its provider's `LINK_ALLOWLIST` before it
 * is sent (https, no userinfo, no port, an allowlisted host); anything else becomes `{ kind: 'none' }`. A post booking
 * keeps its form data with the re-validated URL.
 */
export function safeBooking(b: Booking, providerId: ProviderId): Booking {
  if (b.kind === 'none') return b;
  const checked = validateVendorUrl(b.url, LINK_ALLOWLIST[providerId]);
  if (checked.kind !== 'get') return { kind: 'none' };
  return b.kind === 'post'
    ? { kind: 'post', url: checked.url, postData: b.postData, host: checked.host }
    : checked;
}

/**
 * The same rule for a search link (decision 54): kept only when it re-validates for its provider. Ruling 17
 * (pie-010): a calendar row's own stored vendor link, re-validated the same way, comes first, labelled as the vendor's
 * link for that cached row; the generic search link, with its own label, is the fallback.
 */
export function safeSearchLink(
  providerId: ProviderId,
  cell: CellKey,
  def: SearchDefinition,
  vendorLink: string | null = null,
): ResultRow['searchLink'] {
  if (vendorLink !== null && providerId !== 'fixture') {
    const own = validateVendorUrl(vendorLink, LINK_ALLOWLIST[providerId]);
    if (own.kind === 'get') return { url: own.url, host: own.host, label: SEARCH_LINK_ROW_LABEL };
  }
  const link = searchLinkFor(providerId, cell, def.cabin);
  if (link === null) return null;
  return validateVendorUrl(link.url, LINK_ALLOWLIST[providerId]).kind === 'get' ? link : null;
}

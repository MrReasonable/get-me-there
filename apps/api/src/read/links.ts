/** Vendor links re-validated on the way out (spec §5.2, plan decision 54). */
import {
  type Booking,
  type CellKey,
  LINK_ALLOWLIST,
  type ProviderId,
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

/** The same rule for a search link (decision 54): kept only when it re-validates for its provider. */
export function safeSearchLink(
  providerId: ProviderId,
  cell: CellKey,
  def: SearchDefinition,
): ResultRow['searchLink'] {
  const link = searchLinkFor(providerId, cell, def.cabin);
  if (link === null) return null;
  return validateVendorUrl(link.url, LINK_ALLOWLIST[providerId]).kind === 'get' ? link : null;
}

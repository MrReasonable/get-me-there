import type { Booking } from '../types/itinerary.js';
import type { ProviderId } from '../types/provenance.js';

/**
 * Per-provider booking-link allowlist. Spec §5.2 "Vendor links": `aviasales.com` for
 * Travelpayouts, `google.com` for SearchApi (its step-3 `booking_request` always targets Google).
 * The fixture provider gets none: synthetic rows carry no booking link, and `searchLinkFor`
 * returns null for them too, so nothing about a synthetic price is followable.
 */
export const LINK_ALLOWLIST: Record<ProviderId, string[]> = {
  travelpayouts: ['aviasales.com'],
  searchapi: ['google.com'],
  // why: spec §5.2 rev 32: camoufox links go to google.com only.
  camoufox: ['google.com'],
  fixture: [],
};

/** Longest vendor URL kept; anything longer is `{ kind: 'none' }` (review sec-001). */
export const MAX_URL_LENGTH = 2048;

/**
 * Validate a provider-supplied URL before it is stored or rendered. Spec §5.2: `https:` only,
 * no userinfo, host equal to or a subdomain of an allowlist entry; anything else (including an
 * unparseable string) is `{ kind: 'none' }`. Seller or airline hosts are never linked.
 * Also refused: URLs longer than `MAX_URL_LENGTH`, and an explicit non-default port (decision:
 * the vendors serve on 443, and an arbitrary port on an allowlisted host is not their service).
 * Returns a `get` booking carrying the parsed host so the UI can show it.
 */
export function validateVendorUrl(url: string, allowlist: readonly string[]): Booking {
  if (url.length > MAX_URL_LENGTH) return { kind: 'none' };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: 'none' };
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '')
    return { kind: 'none' };
  // why: WHATWG URL lower-cases and IDNA-encodes the hostname and treats `\` as `/` for https, so
  // `WWW.GOOGLE.COM` matches while `google.com.evil.example`, `evilgoogle.com`, a punycode
  // look-alike, a trailing-dot host and `evil.example\@www.google.com` do not.
  const host = u.hostname;
  const allowed = allowlist.some((entry) => host === entry || host.endsWith(`.${entry}`));
  return allowed ? { kind: 'get', url: u.href, host } : { kind: 'none' };
}

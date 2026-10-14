import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Segment } from '../types/itinerary.js';

/** The hashed fields of a segment, already canonical (spec §6.4). */
export type HashSegment = Pick<Segment, 'marketingCarrier' | 'flightNumber' | 'from' | 'to' | 'departLocal'>;

const LOCAL_MINUTE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function seg(s: HashSegment): string {
  // why: guard the canonical form here too, so a caller that skipped normaliseOffer cannot hash
  // a UTC instant or a seconds-bearing string (spec §6.4: "UTC is never hashed").
  if (!LOCAL_MINUTE_RE.test(s.departLocal))
    throw new RangeError(`departLocal not canonical: ${s.departLocal}`);
  return `${s.marketingCarrier}:${s.flightNumber}:${s.from}:${s.to}:${s.departLocal}`;
}

/**
 * Itinerary identity. Spec §6.4: sha256 (lower-case hex) over
 * `'OUT|' + segs(outbound) + '|IN|' + segs(inbound)`, segments joined by `;`, each
 * `${carrier}:${flightNumber}:${from}:${to}:${departLocal}`. Codeshares hash on the marketing
 * carrier. Price, cabin, provider, seller and tokens are not inputs, so they cannot change it.
 */
export function itineraryHash(outbound: readonly HashSegment[], inbound: readonly HashSegment[]): string {
  const text = `OUT|${outbound.map(seg).join(';')}|IN|${inbound.map(seg).join(';')}`;
  return bytesToHex(sha256(utf8ToBytes(text)));
}

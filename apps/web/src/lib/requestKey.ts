/**
 * Spec rev 55 §10 create-and-start: a fresh `requestKey` (a version 4 UUID) for each Search now press, so the same press
 * sent twice creates one search. Built from `crypto.getRandomValues`, which every browser offers, rather than
 * `crypto.randomUUID`, which exists only in a secure context: the app may be opened over plain HTTP on a home network
 * (docs/setup.md), where `randomUUID` is undefined and the press would throw.
 */
export function newRequestKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  // why: RFC 9562 §5.4 — the version nibble is 4 and the variant bits are 10, as zod's `uuid()` checks
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

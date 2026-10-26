/**
 * The choice a SOCS value records (spec §2 "Consent"; decision 74; brief WP17 §0a; review X1). Pure, no imports, so
 * socs.ts and consentLine.ts both use it without a cycle.
 *
 * As observed on 2026-10-25 (research 17.0c: darwin-arm64, the GB market, one "Reject all" and one "Accept all"
 * session), the value is the base64url of a protobuf message whose top-level fields are field 1, a one-byte varint (1
 * after "Reject all", 2 after "Accept all"; the values start `CAES` and `CAIS`), then field 2, length-delimited, then
 * field 3. The mark is read only from a value of that shape: canonical base64url; field 1 first, a varint of exactly
 * one byte holding 1 or 2; field 2 (length-delimited) next; and every later top-level field well formed, fitting the
 * value, and never field 1 again (a decoder keeps the last field 1, which this reading would not see). Anything else is
 * `unknown`, which no command ever stores. Whether a choice made under "More options" reads the same is not observed.
 */
export type RejectionMark = 'reject' | 'accept' | 'unknown';

/** A protobuf varint at `at`: its value and the index after it, or null when it is cut off or longer than 10 bytes. */
function varint(b: Uint8Array, at: number): { value: number; next: number } | null {
  let value = 0;
  const end = Math.min(at + 10, b.length);
  for (let i = at; i < end; i++) {
    const c = b[i] ?? 0;
    value += (c & 0x7f) * 2 ** (7 * (i - at));
    if (c < 0x80) return { value, next: i + 1 };
  }
  return null;
}

/** The top-level fields from `at` to the end: each well formed and inside the value, none of them field 0 or 1. */
function restWellFormed(b: Uint8Array, at: number): boolean {
  let i = at;
  while (i < b.length) {
    const tag = varint(b, i);
    if (tag === null || tag.value < 16) return false;
    const wire = tag.value % 8;
    if (wire === 0) {
      const v = varint(b, tag.next);
      if (v === null) return false;
      i = v.next;
    } else if (wire === 2) {
      const len = varint(b, tag.next);
      if (len === null) return false;
      i = len.next + len.value;
    } else if (wire === 1 || wire === 5) i = tag.next + (wire === 1 ? 8 : 4);
    else return false;
    if (i > b.length) return false;
  }
  return true;
}

export function rejectionMark(value: string): RejectionMark {
  const bytes = Buffer.from(value, 'base64url');
  // why: Node's decoder skips what it cannot read, so only a value that encodes back to itself was read whole
  if (bytes.toString('base64url') !== value || bytes[0] !== 0x08 || bytes[2] !== 0x12) return 'unknown';
  const choice = bytes[1] === 0x01 ? 'reject' : bytes[1] === 0x02 ? 'accept' : 'unknown';
  return restWellFormed(bytes, 2) ? choice : 'unknown';
}

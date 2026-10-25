import { addMonthsClamped, type IsoDateTime, isoDateTimeSchema } from '@gmt/core';
import { z } from 'zod';
import { SOCS_DOMAIN, SOCS_MAX_AGE_MONTHS, SOCS_NAME } from './socs.js';

/**
 * The consent choice carried between machines and checked by its own value (spec §2 "Consent"; decision 74; brief WP17
 * §5 and Task 17.5). Beside socs.ts; the CLI never imports it.
 *
 * Research 17.0c (the operator's two sessions of 2026-10-25, one "Reject all" and one "Accept all", recorded on
 * darwin-arm64): the SOCS value is the base64url of a protobuf message. The two values were 68 bytes each and differed
 * in exactly one byte, byte 1, the varint of field 1 (tag 0x08): 0x01 after "Reject all" (the value starts `CAES`) and
 * 0x02 after "Accept all" (`CAIS`). So the choice is read from the value alone: field 1 = 1 is a rejection, 2 an
 * acceptance, and anything else is unknown, which no command ever stores.
 */
export type RejectionMark = 'reject' | 'accept' | 'unknown';

/**
 * The choice a SOCS value records, from its first protobuf field. Pure. A value that is not canonical base64url (a
 * character outside the alphabet, padding, a length no byte string has, or trailing bits an encoder never sets), a
 * first tag other than field 1 as a varint, a varint of more than one byte, or a value too short to hold the field is
 * `unknown`.
 */
export function rejectionMark(value: string): RejectionMark {
  const bytes = Buffer.from(value, 'base64url');
  // why: Node's decoder skips what it cannot read, so only a value that encodes back to itself was read whole
  if (bytes.toString('base64url') !== value || bytes[0] !== 0x08) return 'unknown';
  // why: a multi-byte varint has the high bit set in this byte, so it is never exactly 1 or 2
  return bytes[1] === 0x01 ? 'reject' : bytes[1] === 0x02 ? 'accept' : 'unknown';
}

/** The line's version prefix; a later format takes another. */
export const CONSENT_LINE_PREFIX = 'gmt-socs-v1.';
/** The most `consent import` reads from standard input. */
export const CONSENT_LINE_MAX_BYTES = 4096;

export interface ConsentLine {
  socs: {
    name: typeof SOCS_NAME;
    value: string;
    domain: typeof SOCS_DOMAIN;
    path: '/';
    expires: number;
    secure: true;
    sameSite: 'Lax' | 'Strict' | 'None';
  };
  capturedAt: IsoDateTime;
  mark: RejectionMark;
}
export interface ConsentLineError {
  error: string;
}

const EXPIRY_TOO_LATE = 'the cookie’s expiry is later than 13 months after its capture';

/**
 * The line's fields, strictly: the cookie's name exactly SOCS, its value 1 to 512 base64url characters, its domain
 * `.google.com`, its path `/`, Secure, a SameSite the browser sets, an expiry no later than `capturedAt` + 13 months (the
 * cookie's stated lifetime, calendar months on the UTC date), the capture time, and the mark. Nothing else.
 */
export const consentLineSchema: z.ZodType<ConsentLine> = z
  .strictObject({
    socs: z.strictObject({
      name: z.literal(SOCS_NAME),
      value: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/),
      domain: z.literal(SOCS_DOMAIN),
      path: z.literal('/'),
      expires: z.number(),
      secure: z.literal(true),
      sameSite: z.enum(['Lax', 'Strict', 'None']),
    }),
    capturedAt: isoDateTimeSchema,
    mark: z.enum(['reject', 'accept', 'unknown']),
  })
  .refine((c) => c.socs.expires * 1000 <= Date.parse(addMonthsClamped(c.capturedAt, SOCS_MAX_AGE_MONTHS)), {
    message: EXPIRY_TOO_LATE,
  });

/** One schema issue in words: the field it is on, never the value it holds. */
function refusedWords(issue: z.ZodError['issues'][number]): string {
  if (issue.message === EXPIRY_TOO_LATE) return EXPIRY_TOO_LATE;
  if (issue.code === 'unrecognized_keys') return 'the line has a field it may not have';
  return issue.path.length === 0
    ? 'the line’s fields are refused'
    : `the line’s ${issue.path.join('.')} is refused`;
}

/** `gmt-socs-v1.` and the base64url of the fields; throws on fields the schema refuses. */
export function encodeConsentLine(c: ConsentLine): string {
  return `${CONSENT_LINE_PREFIX}${Buffer.from(JSON.stringify(consentLineSchema.parse(c))).toString('base64url')}`;
}

/**
 * Reads a line back: its prefix, its base64url body, its JSON, the schema, then the mark recomputed from the value,
 * refusing a line whose carried mark is not the value's own (a forged rejection). An error names what is wrong, never a
 * value from the line.
 */
export function decodeConsentLine(line: string): ConsentLine | ConsentLineError {
  if (!line.startsWith(CONSENT_LINE_PREFIX))
    return { error: `the line does not start with ${CONSENT_LINE_PREFIX}` };
  const body = line.slice(CONSENT_LINE_PREFIX.length);
  const bytes = Buffer.from(body, 'base64url');
  if (bytes.toString('base64url') !== body) return { error: 'the line is not base64url' };
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { error: 'the line does not hold JSON' };
  }
  const r = consentLineSchema.safeParse(raw);
  if (!r.success) return { error: r.error.issues.map(refusedWords).join('; ') };
  const own = rejectionMark(r.data.socs.value);
  if (own !== r.data.mark)
    return { error: `the line’s mark (${r.data.mark}) is not its value’s own (${own})` };
  return r.data;
}

/**
 * Readers of the recorded tree (ca-011, split from recorder.ts): any hashed file after the spec §5.5 root checks, and
 * one recorded fixture validated against its schema and its content hash.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { isoDateTimeSchema } from '@gmt/core';
import { z } from 'zod';
import { isRecord, zodReason } from '../util.js';
import {
  assertRecordedRoot,
  defaultRecordedRoot,
  RECORDED_RESPONSE_HEADER,
  type RecordedFixture,
  SAFE_PATH,
  verifyContentHash,
} from './recorder.js';

/** A recording's file name: its recorded day and the first 12 hex digits of its content hash. */
const FILE_NAME = /^(\d{4}-\d{2}-\d{2})-([0-9a-f]{12})\.json$/;

/** Loads any hashed file of the recorded tree (a recording or a ParamsAllowlist) after the §5.5 checks. */
export function loadRecordedJson(
  path: string,
  root: string = defaultRecordedRoot(),
): Record<string, unknown> {
  // why: readers apply the recorder's own root rule, so a symlink named …/fixtures/recorded that points elsewhere is
  // refused by readers too (re-review low 2).
  const realRoot = assertRecordedRoot(root);
  const real = realpathSync(path);
  if (!real.startsWith(`${realRoot}${sep}`))
    throw new Error(`refusing ${path}: recorded files load only from the recorded root ${root} (spec §5.5)`);
  const json: unknown = JSON.parse(readFileSync(real, 'utf8'));
  if (!isRecord(json)) throw new Error(`refusing ${path}: not a JSON object`);
  if ('synthetic' in json) throw new Error(`refusing ${path}: a synthetic file inside the recorded tree`);
  if (typeof json.recordedAt !== 'string') throw new Error(`refusing ${path}: recordedAt is required`);
  if (!verifyContentHash(json))
    throw new Error(`refusing ${path}: content hash mismatch (edited after recording?)`);
  return json;
}

const nonBlank = (what: string) =>
  z.string().refine((v) => v.trim() !== '', { message: `${what} is missing or empty` });

/** The pinned RecordedFixture shape (plan http-kit block), checked field by field by zod (prov-002). */
const recordedFixtureSchema = z.object({
  recordedAt: isoDateTimeSchema,
  recordedBy: nonBlank('recordedBy'),
  providerId: z.string().min(1),
  endpointPath: z.string().regex(SAFE_PATH),
  request: z.object({
    method: z.string(),
    url: z.string(),
    headers: z.record(z.string(), z.string()),
    body: z.string().nullable(),
  }),
  status: z.number().int(),
  body: z.unknown(),
  placeholders: z.record(z.string(), z.string()),
  responseHeaders: z.record(z.string().regex(RECORDED_RESPONSE_HEADER), z.string()),
  session: z.string().min(1),
  contentSha256: z.string(),
});

/** Loads one recorded HTTP attempt with every field and its location checked (prov-002); built field by field. */
export function loadRecordedFixture(path: string, root: string = defaultRecordedRoot()): RecordedFixture {
  const json = loadRecordedJson(path, root);
  const fail = (why: string): Error => new Error(`refusing ${path}: ${why}`);
  const parsed = recordedFixtureSchema.safeParse(json);
  if (!parsed.success) throw fail(zodReason(parsed.error));
  const {
    recordedAt,
    recordedBy,
    providerId,
    endpointPath,
    request,
    status,
    placeholders,
    responseHeaders,
    session,
  } = parsed.data;
  const { contentSha256 } = parsed.data;
  const parts = relative(realpathSync(resolve(root)), realpathSync(path)).split(sep);
  const [dirProvider, dirEndpoint, fileName = ''] = parts;
  if (parts.length !== 3 || dirProvider !== providerId || dirEndpoint !== endpointPath.replaceAll('/', '_')) {
    throw fail('the file is not under <root>/<providerId>/<endpointPath with / → _>/');
  }
  const name = FILE_NAME.exec(fileName);
  if (name === null || name[1] !== recordedAt.slice(0, 10) || name[2] !== contentSha256.slice(0, 12)) {
    throw fail('the file name does not match recordedAt and contentSha256');
  }
  // why: built explicitly so `body` stays a required field of the contract whatever zod infers for z.unknown().
  return {
    recordedAt,
    recordedBy,
    providerId,
    endpointPath,
    request,
    status,
    body: json.body,
    placeholders,
    responseHeaders,
    session,
    contentSha256,
  };
}

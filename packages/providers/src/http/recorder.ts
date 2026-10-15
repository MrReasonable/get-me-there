import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Clock, type IsoDateTime, isoDateTimeSchema, type Secret } from '@gmt/core';
import { z } from 'zod';
import { errnoCode, isRecord, parseMaybeJson, zodReason } from '../util.js';
import { CREDENTIAL_HEADERS } from './cacheKey.js';
import { containsSecret, stripUrl } from './scrub.js';
import type { FixtureRecorder } from './types.js';

/** The recorder refused to write (credential present, token outside a token position, wrong tree, synthetic provider). */
export class RecorderRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecorderRefusedError';
  }
}

/** One recorded HTTP attempt; the format pinned in the plan's http-kit contract. */
export interface RecordedFixture {
  recordedAt: IsoDateTime;
  recordedBy: string;
  providerId: string;
  endpointPath: string;
  request: { method: string; url: string; headers: Record<string, string>; body: string | null };
  status: number;
  body: unknown;
  placeholders: Record<string, string>;
  /**
   * Allowlisted response headers, names lower-cased: retry-after, content-type, x-ratelimit-*, ratelimit-* (plan
   * decision 20). Inside the hash; replay serves them. A secret in one refuses the recording, like anywhere else.
   */
  responseHeaders: Record<string, string>;
  /** The recording session: recorder creation instant plus a random suffix; the same value the placeholders carry (prov-r2-001). */
  session: string;
  contentSha256: string;
}

const TOKEN_KEY = /^[a-z0-9]+(?:_[a-z0-9]+)*_token$/;
const RECORDED_DIR = `${sep}fixtures${sep}recorded`;
const SAFE_PATH = /^\/[A-Za-z0-9._/-]*$/;
/** Response header names a recording keeps (plan decision 20); everything else is dropped. */
const RECORDED_RESPONSE_HEADER = /^(?:retry-after|content-type|x-ratelimit-[a-z0-9-]+|ratelimit-[a-z0-9-]+)$/;
const FILE_NAME = /^(\d{4}-\d{2}-\d{2})-([0-9a-f]{12})\.json$/;

/** Absolute path of this package's recorded tree (works from src/ and dist/). */
export function defaultRecordedRoot(): string {
  return fileURLToPath(new URL('../../fixtures/recorded', import.meta.url));
}

/**
 * The real path of a recorded root, refused unless it exists and its real path ends in fixtures/recorded (spec §5.5).
 * why: the suffix is tested on the real path, so a symlink named …/fixtures/recorded cannot point elsewhere (I1); the
 * recorder, the readers and WP4b's allowlist writer share this one rule (WP4b I-3).
 */
export function assertRecordedRoot(root: string): string {
  let real: string;
  try {
    real = realpathSync(resolve(root));
  } catch (e) {
    // why: only absence is reported as such; EACCES, ELOOP and the rest surface unchanged (re-review low 1).
    if (errnoCode(e) === 'ENOENT') throw new RecorderRefusedError(`recorder root ${root} does not exist`);
    throw e;
  }
  if (!real.endsWith(RECORDED_DIR))
    throw new RecorderRefusedError(`recorder root must end in fixtures/recorded (spec §5.5), got ${real}`);
  return real;
}

/** JSON with object keys sorted at every level and undefined members dropped: the hash input. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (isRecord(v)) {
    const entries = Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

function hashOf(file: object): string {
  const rest = Object.fromEntries(Object.entries(file).filter(([k]) => k !== 'contentSha256'));
  return createHash('sha256').update(canonicalJson(rest)).digest('hex');
}

/** sha256 hex over canonicalJson of a recording without its hash field. Tamper-evidence, not a signature (prov-003). */
export function contentHash(f: Omit<RecordedFixture, 'contentSha256'>): string {
  return hashOf(f);
}

/** Adds `contentSha256` over everything else (the main barrel exports it for WP4b's allowlist writer; tests use it too). */
export function withContentHash<T extends object>(file: T): T & { contentSha256: string } {
  return { ...file, contentSha256: hashOf(file) };
}

/** Recomputes the content hash of any recorded-tree JSON; false for anything edited after recording. */
export function verifyContentHash(file: unknown): boolean {
  return isRecord(file) && typeof file.contentSha256 === 'string' && hashOf(file) === file.contentSha256;
}

/** Token-named query parameters of a URL string (empty for anything that is not an http(s) URL). */
function urlTokenParams(s: string): Array<[string, string]> {
  if (!/^https?:\/\//i.test(s)) return [];
  try {
    return [...new URL(s).searchParams.entries()].filter(([k, v]) => TOKEN_KEY.test(k) && v !== '');
  } catch {
    return [];
  }
}

/** Placeholder table for opaque vendor tokens, scoped to one recording session (prov-006). */
function tokenTable(session: string) {
  const byRaw = new Map<string, { placeholder: string; key: string }>();
  const counters = new Map<string, number>();
  const register = (key: string, raw: string, seen: Set<string>): void => {
    seen.add(raw);
    if (byRaw.has(raw)) return;
    const n = counters.get(key) ?? 0;
    counters.set(key, n + 1);
    byRaw.set(raw, { placeholder: `<${key}:${n}@${session}>`, key });
  };
  const collect = (v: unknown, seen: Set<string>): void => {
    if (typeof v === 'string') {
      for (const [k, raw] of urlTokenParams(v)) register(k, raw, seen);
    } else if (Array.isArray(v)) {
      for (const x of v) collect(x, seen);
    } else if (isRecord(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (TOKEN_KEY.test(k) && typeof x === 'string' && x !== '') register(k, x, seen);
        else collect(x, seen);
      }
    }
  };
  const placeholderOf = (raw: string, used: Map<string, string>): string | undefined => {
    const t = byRaw.get(raw);
    if (t === undefined) return undefined;
    used.set(t.placeholder, t.key);
    return t.placeholder;
  };
  const replaceUrl = (s: string, used: Map<string, string>): string => {
    const pairs = urlTokenParams(s);
    if (pairs.length === 0) return s;
    const u = new URL(s);
    u.search = new URLSearchParams(
      [...u.searchParams.entries()].map(([k, v]): [string, string] => [
        k,
        (TOKEN_KEY.test(k) ? placeholderOf(v, used) : undefined) ?? v,
      ]),
    ).toString();
    return u.href;
  };
  // why: only token positions are rewritten (prov-007); any raw token left elsewhere makes the recorder refuse.
  const deep = (v: unknown, used: Map<string, string>): unknown => {
    if (typeof v === 'string') return replaceUrl(v, used);
    if (Array.isArray(v)) return v.map((x) => deep(x, used));
    if (isRecord(v)) {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [
          k,
          TOKEN_KEY.test(k) && typeof x === 'string' ? (placeholderOf(x, used) ?? x) : deep(x, used),
        ]),
      );
    }
    return v;
  };
  return { register, collect, placeholderOf, replaceUrl, deep };
}

/** Strips query and userinfo from every URL string under a `search_metadata` key (spec §5.3). */
function stripMetadataUrls(v: unknown, inside: boolean): unknown {
  if (typeof v === 'string') return inside && /^https?:\/\//i.test(v) ? stripUrl(v) : v;
  if (Array.isArray(v)) return v.map((x) => stripMetadataUrls(x, inside));
  if (isRecord(v))
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, stripMetadataUrls(x, inside || k === 'search_metadata')]),
    );
  return v;
}

/** lstat without following links: a real directory, anything else (symlink, file), or nothing yet. */
function directoryState(path: string): 'directory' | 'other' | 'missing' {
  try {
    const st = lstatSync(path);
    return st.isDirectory() && !st.isSymbolicLink() ? 'directory' : 'other';
  } catch (e) {
    if (errnoCode(e) === 'ENOENT') return 'missing';
    throw e;
  }
}

/** Writes `text` unless the file exists (same content on the same day hashes to the same name). */
function writeOnce(path: string, text: string): void {
  try {
    writeFileSync(path, text, { flag: 'wx' });
  } catch (e) {
    if (errnoCode(e) !== 'EEXIST') throw e;
  }
}

/**
 * Fixture recorder, spec §5.3 "Recorder": writes RecordedFixture files under `<root>` (which must end in
 * fixtures/recorded) with the raw vendor body beside each as `.raw.json` (gitignored), and fails closed.
 */
export function createRecorder(opts: {
  root: string;
  secrets: readonly Secret[];
  clock: Clock;
  recordedBy: string;
}): FixtureRecorder {
  // why: the returned path is reported under the root as given (a caller's symlinked path stays recognisable)
  const givenRoot = resolve(opts.root);
  const root = assertRecordedRoot(opts.root);
  if (opts.recordedBy.trim() === '')
    throw new RecorderRefusedError('recordedBy must name who ran the recording');
  // why: two sessions never share an identity, even when started in the same millisecond (prov-r2-001).
  const session = `${opts.clock.now().replace(/[-:.]/g, '')}-${randomBytes(3).toString('hex')}`;
  const tokens = tokenTable(session);
  const refuse = (r: { providerId: string; endpointPath: string }, why: string): RecorderRefusedError =>
    new RecorderRefusedError(
      `refusing to record ${r.providerId} ${SAFE_PATH.test(r.endpointPath) ? r.endpointPath : '<unsafe endpointPath>'}: ${why}`,
    );

  return {
    async record(r) {
      if (r.providerId === 'fixture')
        throw refuse(r, 'the fixture provider is synthetic and is never recorded (spec §5.5)');
      if (!SAFE_PATH.test(r.endpointPath) || r.endpointPath.includes('..'))
        throw refuse(r, 'unsafe endpointPath');
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(r.request.headers)) {
        const lower = name.toLowerCase();
        if (CREDENTIAL_HEADERS.has(lower)) continue;
        if (containsSecret(value, opts.secrets))
          throw refuse(r, `a credential appears in header ${lower} (test-005)`);
        headers[lower] = value;
      }

      const seen = new Set<string>();
      const params = [...r.request.url.searchParams.entries()];
      for (const [k, v] of params) if (TOKEN_KEY.test(k) && v !== '') tokens.register(k, v, seen);
      const requestJson = parseMaybeJson(r.request.body);
      tokens.collect(requestJson, seen);
      tokens.collect(r.body, seen);

      const used = new Map<string, string>();
      const url = new URL(r.request.url.href);
      url.username = '';
      url.password = '';
      url.hash = '';
      url.search = new URLSearchParams(
        params.map(([k, v]): [string, string] => [
          k,
          (TOKEN_KEY.test(k) ? tokens.placeholderOf(v, used) : undefined) ?? v,
        ]),
      ).toString();
      const requestBody =
        r.request.body === undefined
          ? null
          : typeof requestJson === 'string'
            ? requestJson
            : JSON.stringify(tokens.deep(requestJson, used));
      const body = tokens.deep(stripMetadataUrls(r.body, false), used);
      const unhashed: Omit<RecordedFixture, 'contentSha256'> = {
        // why: the instant the response arrived (http-kit's clock), not the recorder's write time (prov-r2-003).
        recordedAt: r.fetchedAt,
        recordedBy: opts.recordedBy,
        providerId: r.providerId,
        endpointPath: r.endpointPath,
        request: { method: r.request.method, url: url.href, headers, body: requestBody },
        status: r.status,
        body,
        placeholders: Object.fromEntries([...used].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
        // why: Headers yields lower-cased names; a value is not scrubbed but fails closed below like the body (spec §5.3).
        responseHeaders: Object.fromEntries(
          [...(r.responseHeaders?.entries() ?? [])]
            .filter(([name]) => RECORDED_RESPONSE_HEADER.test(name))
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        ),
        session,
      };
      const file: RecordedFixture = { ...unhashed, contentSha256: contentHash(unhashed) };
      const text = `${JSON.stringify(file, null, 2)}\n`;
      const raw = `${JSON.stringify(r.body, null, 2) ?? 'null'}\n`;
      if (containsSecret(text, opts.secrets) || containsSecret(raw, opts.secrets))
        throw refuse(r, 'a credential would be written (spec §5.3)');
      if ([...seen].some((t) => text.includes(t)))
        throw refuse(
          r,
          'an opaque token also appears outside a token position; nothing is rewritten (prov-007)',
        );

      const providerDir = join(root, r.providerId);
      const dir = join(providerDir, r.endpointPath.replaceAll('/', '_'));
      // why: each component is checked with lstat before anything is created under it, and created one level at a
      // time, so a symlinked provider or endpoint directory cannot redirect a mkdir or a write outside the recorded
      // tree (review I1). A component swapped for a symlink between this check and the `wx` write is still possible;
      // that needs local write access to the repository, which is outside this operator-run tool's threat model.
      for (const d of [providerDir, dir]) {
        const state = directoryState(d);
        if (state === 'missing') {
          try {
            mkdirSync(d);
          } catch (e) {
            if (errnoCode(e) !== 'EEXIST') throw e;
          }
          if (directoryState(d) !== 'directory') throw refuse(r, `${d} is not a plain directory`);
        } else if (state !== 'directory') throw refuse(r, `${d} is a symlink or not a directory`);
      }
      const target = join(dir, `${file.recordedAt.slice(0, 10)}-${file.contentSha256.slice(0, 12)}.json`);
      writeOnce(target, text);
      writeOnce(target.replace(/\.json$/, '.raw.json'), raw);
      // why: the path is reported under the root as the caller named it (the same file as the real path written).
      return join(givenRoot, relative(root, target));
    },
  };
}

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

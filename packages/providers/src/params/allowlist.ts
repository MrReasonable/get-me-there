import { type Dirent, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type IsoDate, isoDateSchema, type ProviderId, providerIdSchema } from '@gmt/core';
import { z } from 'zod';
import { loadRecordedJson } from '../http/recordedFiles.js';
import { defaultRecordedRoot } from '../http/recorder.js';
import { byPair, errnoCode, parseOrThrow } from '../util.js';

/**
 * Dated parameter allowlist, spec §5.2: every parameter name **and value** an adapter may send, per endpoint key
 * (`<path>` or `<path>?<name>=<value>`). Written by WP4b under fixtures/recorded/<provider>/params-<date>.json with
 * withContentHash; WP5/WP6 hold an equal code constant (SEARCHAPI_PARAMS, TRAVELPAYOUTS_PARAMS) and assert the two match.
 */
export interface ParamsAllowlist {
  provider: ProviderId;
  recordedAt: IsoDate;
  endpoints: Record<string, { names: string[]; values: Record<string, string[] | 'any'> }>;
  contentSha256: string;
}

/** A request would send a parameter or value the dated allowlist does not list. */
export class ParamsNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParamsNotAllowedError';
  }
}

// why: the discriminator value is restricted to the unreserved charset (RFC 3986), so its raw form in the key and its
// decoded form from URLSearchParams are identical and the key can never silently miss (review I2).
const KEY = /^(\/[^?#]*)(?:\?([a-z0-9_]+)=([A-Za-z0-9._~-]+))?$/;

function parseKey(key: string): { path: string; name: string | undefined; value: string | undefined } | null {
  const m = KEY.exec(key);
  if (m === null || m[1] === undefined) return null;
  return { path: m[1], name: m[2], value: m[3] };
}

const endpointSchema = z
  .object({
    names: z.array(z.string()),
    values: z.record(z.string(), z.union([z.literal('any'), z.array(z.string()).min(1)])),
  })
  .superRefine((e, ctx) => {
    e.names.forEach((n, i) => {
      const prev = e.names[i - 1];
      if (prev !== undefined && !(prev < n))
        ctx.addIssue({
          code: 'custom',
          path: ['names', i],
          message: `names must be strictly ascending (${prev}, ${n})`,
        });
      if (e.values[n] === undefined)
        ctx.addIssue({
          code: 'custom',
          path: ['values', n],
          message: `name ${n} needs 'any' or a non-empty value list`,
        });
    });
    for (const k of Object.keys(e.values))
      if (!e.names.includes(k))
        ctx.addIssue({
          code: 'custom',
          path: ['values', k],
          message: `values lists ${k}, which is not in names`,
        });
  });

/** The file form of a ParamsAllowlist; provider and recordedAt come from core's schemas, so the brands need no cast. */
const allowlistFileSchema = z.object({
  provider: providerIdSchema,
  recordedAt: isoDateSchema,
  endpoints: z.record(z.string(), endpointSchema).superRefine((endpoints, ctx) => {
    for (const [key, entry] of Object.entries(endpoints)) {
      const k = parseKey(key);
      if (k === null) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `endpoint key ${key} must be <path> or <path>?<name>=<value>`,
        });
        continue;
      }
      // why: an entry selected by `name=value` must itself allow exactly that value of `name`, or the file contradicts
      // its own key (review I2).
      if (k.name === undefined || k.value === undefined) continue;
      const allowed = entry.values[k.name];
      if (
        !entry.names.includes(k.name) ||
        !Array.isArray(allowed) ||
        allowed.length !== 1 ||
        allowed[0] !== k.value
      )
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `a discriminated entry must list its discriminator ${k.name} with exactly the value of its key`,
        });
    }
  }),
  contentSha256: z.string(),
});

/** Loads and validates an allowlist file (recorded tree, content hash, core schemas, key form, ascending names, values per name). */
export function loadParamsAllowlist(path: string, root: string = defaultRecordedRoot()): ParamsAllowlist {
  return parseOrThrow(allowlistFileSchema, loadRecordedJson(path, root), `refusing params allowlist ${path}`);
}

type Selected = { entry: ParamsAllowlist['endpoints'][string] } | { refusal: string };

/** The entry `url` selects for `endpointPath` (the most specific matching key), or why none does. */
function selectEntry(allowlist: ParamsAllowlist, endpointPath: string, url: URL): Selected {
  const who = `${allowlist.provider} ${endpointPath}`;
  if (url.pathname !== endpointPath) return { refusal: `${who}: URL path does not match the endpoint` };
  // why: key selection and value checks must read one value per name; a vendor may honour the last of several (review I2).
  const seen = new Set<string>();
  for (const name of url.searchParams.keys()) {
    if (seen.has(name)) return { refusal: `${who}: parameter ${name} is repeated` };
    seen.add(name);
  }
  let bare: string | undefined;
  const matching: string[] = [];
  let discriminated = false;
  for (const key of Object.keys(allowlist.endpoints).sort()) {
    const k = parseKey(key);
    if (k === null || k.path !== endpointPath) continue;
    if (k.name === undefined) bare = key;
    else {
      discriminated = true;
      if (url.searchParams.get(k.name) === k.value) matching.push(key);
    }
  }
  // why: two matching discriminated keys would otherwise be resolved by sort order, a rule no file author wrote (I2).
  if (matching.length > 1)
    return { refusal: `${who}: more than one discriminated allowlist entry matches this request` };
  const key = matching[0] ?? bare;
  const entry = key === undefined ? undefined : allowlist.endpoints[key];
  if (entry === undefined)
    return {
      refusal:
        key === undefined && discriminated
          ? `${who}: no allowlist entry matches this request's discriminator`
          : `${who}: endpoint is not in the ${allowlist.recordedAt} allowlist`,
    };
  return { entry };
}

/**
 * Throws ParamsNotAllowedError unless every query parameter of `url` is listed, with an allowed value, under the most
 * specific matching key for `endpointPath` (spec §5.2). Adapters call it before http-kit; messages name parameters only.
 */
export function assertRequestAllowed(allowlist: ParamsAllowlist, endpointPath: string, url: URL): void {
  const who = `${allowlist.provider} ${endpointPath}`;
  const selected = selectEntry(allowlist, endpointPath, url);
  if ('refusal' in selected) throw new ParamsNotAllowedError(selected.refusal);
  const { entry } = selected;
  for (const [name, value] of url.searchParams.entries()) {
    if (!entry.names.includes(name))
      throw new ParamsNotAllowedError(
        `${who}: parameter ${name} is not in the ${allowlist.recordedAt} allowlist`,
      );
    const allowed = entry.values[name];
    if (allowed !== 'any' && !(allowed ?? []).includes(value))
      throw new ParamsNotAllowedError(
        `${who}: a value of ${name} is not in the ${allowlist.recordedAt} allowlist`,
      );
  }
}

/**
 * The parameter names the entry `url` selects lists, or undefined when the request selects no entry. Replay reads it to
 * tell which of a request's parameters a recording's own allowlist could not have sent (spec §5.2 dated history).
 */
export function allowedNames(
  allowlist: ParamsAllowlist,
  endpointPath: string,
  url: URL,
): readonly string[] | undefined {
  const selected = selectEntry(allowlist, endpointPath, url);
  return 'entry' in selected ? selected.entry.names : undefined;
}

const PARAMS_FILE = /^params-\d{4}-\d{2}-\d{2}\.json$/;

/**
 * Every dated allowlist under `root` (`<provider>/params-<date>.json`), loaded and validated, in provider then date
 * order: the dated allowlist history. A parameter added on a later date is in the later file only, so a recording keeps
 * the allowlist it was made under (plan decision 24) and replay can tell what that recording could not have sent.
 */
export function loadParamsHistory(root: string = defaultRecordedRoot()): ParamsAllowlist[] {
  let dirs: Dirent[];
  try {
    dirs = readdirSync(root, { withFileTypes: true });
  } catch (e) {
    // why: a missing tree is the fresh-checkout case (decision 61), an empty history; any other failure is itself.
    if (errnoCode(e) === 'ENOENT') return [];
    throw e;
  }
  const out: ParamsAllowlist[] = [];
  for (const dir of dirs.filter((d) => d.isDirectory()))
    for (const name of readdirSync(join(root, dir.name)).filter((n) => PARAMS_FILE.test(n)))
      out.push(loadParamsAllowlist(join(root, dir.name, name), root));
  return out.sort((a, b) => byPair([a.provider, a.recordedAt], [b.provider, b.recordedAt]));
}

import { type IsoDate, isoDateSchema, type ProviderId, providerIdSchema } from '@gmt/core';
import { defaultRecordedRoot, loadRecordedJson } from '../http/recorder.js';
import { isRecord } from '../util.js';

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

const KEY = /^(\/[^?#]*)(?:\?([a-z0-9_]+)=([^&=#]+))?$/;

function parseKey(key: string): { path: string; name: string | undefined; value: string | undefined } | null {
  const m = KEY.exec(key);
  if (m === null || m[1] === undefined) return null;
  return { path: m[1], name: m[2], value: m[3] };
}

/** Loads and validates an allowlist file (recorded tree, content hash, core schemas, key form, ascending names, values per name). */
export function loadParamsAllowlist(path: string, root: string = defaultRecordedRoot()): ParamsAllowlist {
  const json = loadRecordedJson(path, root);
  const fail = (why: string): Error => new Error(`refusing params allowlist ${path}: ${why}`);
  const provider = providerIdSchema.safeParse(json.provider);
  if (!provider.success) throw fail('unknown provider');
  const recordedAt = isoDateSchema.safeParse(json.recordedAt);
  if (!recordedAt.success) throw fail('recordedAt must be a real YYYY-MM-DD date');
  const rawEndpoints = json.endpoints;
  if (!isRecord(rawEndpoints)) throw fail('endpoints must be an object keyed by endpoint');
  const endpoints: ParamsAllowlist['endpoints'] = {};
  for (const [key, entry] of Object.entries(rawEndpoints)) {
    if (parseKey(key) === null) throw fail(`endpoint key ${key} must be <path> or <path>?<name>=<value>`);
    if (!isRecord(entry)) throw fail(`endpoint ${key} is not an object`);
    const rawNames = entry.names;
    const rawValues = entry.values;
    if (!Array.isArray(rawNames) || !isRecord(rawValues))
      throw fail(`endpoint ${key} needs names and values`);
    const names: string[] = [];
    for (const n of rawNames) {
      if (typeof n !== 'string') throw fail(`endpoint ${key}: names must be strings`);
      const prev = names[names.length - 1];
      if (prev !== undefined && !(prev < n))
        throw fail(`endpoint ${key}: names must be strictly ascending (${prev}, ${n})`);
      names.push(n);
    }
    const values: Record<string, string[] | 'any'> = {};
    for (const n of names) {
      const v = rawValues[n];
      if (v === 'any') values[n] = 'any';
      else if (Array.isArray(v) && v.length > 0 && v.every((x): x is string => typeof x === 'string'))
        values[n] = [...v];
      else throw fail(`endpoint ${key}: name ${n} needs 'any' or a non-empty value list`);
    }
    for (const k of Object.keys(rawValues))
      if (!names.includes(k)) throw fail(`endpoint ${key}: values lists ${k}, which is not in names`);
    endpoints[key] = { names, values };
  }
  const contentSha256 = json.contentSha256;
  if (typeof contentSha256 !== 'string') throw fail('contentSha256 is missing');
  return { provider: provider.data, recordedAt: recordedAt.data, endpoints, contentSha256 };
}

/**
 * Throws ParamsNotAllowedError unless every query parameter of `url` is listed, with an allowed value, under the most
 * specific matching key for `endpointPath` (spec §5.2). Adapters call it before http-kit; messages name parameters only.
 */
export function assertRequestAllowed(allowlist: ParamsAllowlist, endpointPath: string, url: URL): void {
  const who = `${allowlist.provider} ${endpointPath}`;
  if (url.pathname !== endpointPath)
    throw new ParamsNotAllowedError(`${who}: URL path does not match the endpoint`);
  let bare: string | undefined;
  let chosen: string | undefined;
  let discriminated = false;
  for (const key of Object.keys(allowlist.endpoints).sort()) {
    const k = parseKey(key);
    if (k === null || k.path !== endpointPath) continue;
    if (k.name === undefined) bare = key;
    else {
      discriminated = true;
      if (url.searchParams.get(k.name) === k.value) chosen = key;
    }
  }
  const key = chosen ?? bare;
  if (key === undefined) {
    throw new ParamsNotAllowedError(
      discriminated
        ? `${who}: no allowlist entry matches this request's discriminator`
        : `${who}: endpoint is not in the ${allowlist.recordedAt} allowlist`,
    );
  }
  const entry = allowlist.endpoints[key];
  if (entry === undefined)
    throw new ParamsNotAllowedError(`${who}: endpoint is not in the ${allowlist.recordedAt} allowlist`);
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

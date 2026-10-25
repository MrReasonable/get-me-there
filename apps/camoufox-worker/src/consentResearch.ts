import { CONSENT_SAVE_PATH } from './consentDriver.js';
import { CONSENT_HOST } from './consentWatch.js';
import type { RequestLike } from './driver.js';
import { SELECTORS } from './selectors.js';

/**
 * Research 17.0c's recorder kind (spec §2 "Recordings first"; decision 74; brief WP17 Task 17.4): one run, two headed
 * sessions in throwaway profiles, the person asked to click "Reject all" in the first and "Accept all" in the second.
 * A request listener keeps each consent-related request's method, host and path. Bodies are read only when they are
 * form-encoded, and only the consent host's `/save` submission's fields are kept, by name (W8; pie-b1-004); any other
 * POST records its content type and, for JSON, its top-level key names only. Values are held in memory until both
 * sessions are over, compared, and dropped, except one: when the two `/save` submissions (exactly one per session)
 * differ in exactly one field, and both its values are short plain tokens under a name that is not a token's, those two
 * values are kept (pie-b1-005, sec-b1-005). The two sessions' SOCS fields are kept, so the rejection mark can be derived
 * from them. Pure; researchSession.ts runs the sessions.
 */
/** One request as the listener holds it, values in memory only. */
export interface ObservedRequest {
  method: string;
  host: string;
  path: string;
  /** The form's fields (the consent `/save` submission only), values in memory only. */
  fields: ReadonlyMap<string, string>;
  /** Another POST's body: its content type and, for JSON, its top-level key names; null when none was read. */
  body: { contentType: string; jsonKeys: string[] } | null;
}

const RESEARCH_HOSTS = new Set([CONSENT_HOST, SELECTORS.hosts.results]);
const FORM = 'application/x-www-form-urlencoded';

/** The top-level key names of a JSON object body, or none (never a value). */
function jsonKeys(body: string): string[] {
  try {
    const raw: unknown = JSON.parse(body);
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? Object.keys(raw).slice(0, 50)
      : [];
  } catch {
    return [];
  }
}

/**
 * A document navigation or a POST to the consent host or the results host; null for anything else (subresources,
 * other hosts). Only the consent `/save` submission's form fields are parsed. Never throws.
 */
export function observe(r: RequestLike): ObservedRequest | null {
  let u: URL;
  try {
    u = new URL(r.url());
  } catch {
    return null;
  }
  const method = r.method();
  if (!RESEARCH_HOSTS.has(u.hostname) || (!r.isNavigationRequest() && method !== 'POST')) return null;
  const fields = new Map<string, string>();
  let body: ObservedRequest['body'] = null;
  if (method === 'POST') {
    let text: string | null;
    let type: string;
    try {
      text = r.postData?.() ?? null;
      type = (r.headers?.()['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    } catch {
      text = null;
      type = '';
    }
    const save = u.hostname === CONSENT_HOST && u.pathname === CONSENT_SAVE_PATH;
    if (text !== null && save && type === FORM) {
      for (const [k, v] of new URLSearchParams(text)) if (!fields.has(k)) fields.set(k, v);
    } else if (text !== null)
      body = { contentType: type, jsonKeys: type.endsWith('json') ? jsonKeys(text) : [] };
  }
  return { method, host: u.hostname, path: u.pathname, fields, body };
}

/** What one session left: what it asked for, its requests, the SOCS fields set after the choice, and how it ended. */
export interface ResearchSession {
  /** The button the person was asked to click: the instruction given, not an observation (see the record's note). */
  prompted: 'reject' | 'accept';
  requests: readonly ObservedRequest[];
  socs: Readonly<Record<string, string | number | boolean>> | null;
  socsBeforeChoice: boolean;
  hosts: readonly string[];
  ended: string;
}

/** The record written: names everywhere, and the one differing value when it is safe to keep. */
export interface ResearchRecord {
  note: string;
  sessions: Array<{
    prompted: 'reject' | 'accept';
    requests: Array<{
      method: string;
      host: string;
      path: string;
      fieldNames: string[];
      body?: { contentType: string; jsonKeys: string[] };
    }>;
    socs: Readonly<Record<string, string | number | boolean>> | null;
    socsBeforeChoice: boolean;
    hosts: string[];
    ended: string;
  }>;
  /** The `/save` field whose value differs between the two sessions, with both values; or the names; or why not. */
  differing: { name: string; reject: string; accept: string } | { names: string[] } | { none: string };
}

export const RESEARCH_NOTE =
  'prompted is the button each session asked the person to click, not an observation; differing compares the consent host’s /save submissions, one per session, and research 17.0c checks it against the two SOCS values before a rejection mark is written';

/** A value safe to keep: a short plain token. */
const PLAIN = /^[A-Za-z0-9_.:-]{1,64}$/;
/** Names whose values are a session's own (a return address, an anti-forgery token, an id), never kept. */
const TOKEN_NAME = /^(continue|at|sid|bl|x|pc|ved|ei)$|token|sig|session|nonce|csrf/i;

const saveOf = (s: ResearchSession): ObservedRequest[] =>
  s.requests.filter((r) => r.method === 'POST' && r.host === CONSENT_HOST && r.path === CONSENT_SAVE_PATH);

/** Pure: the two sessions as they are saved. */
export function researchRecord(reject: ResearchSession, accept: ResearchSession): ResearchRecord {
  const a = saveOf(reject);
  const b = saveOf(accept);
  let differing: ResearchRecord['differing'];
  const ra = a[0];
  const rb = b[0];
  if (a.length !== 1 || b.length !== 1 || ra === undefined || rb === undefined)
    differing = {
      none: `each session needs exactly one consent submission (found ${a.length} and ${b.length})`,
    };
  else {
    const names = [...ra.fields.keys()]
      .filter((n) => rb.fields.has(n) && rb.fields.get(n) !== ra.fields.get(n))
      .sort();
    const only = names.length === 1 ? names[0] : undefined;
    const va = only === undefined ? undefined : ra.fields.get(only);
    const vb = only === undefined ? undefined : rb.fields.get(only);
    if (names.length === 0) differing = { none: 'the two submissions carry the same values' };
    else if (
      only !== undefined &&
      va !== undefined &&
      vb !== undefined &&
      PLAIN.test(va) &&
      PLAIN.test(vb) &&
      !TOKEN_NAME.test(only)
    )
      differing = { name: only, reject: va, accept: vb };
    else differing = { names };
  }
  return {
    note: RESEARCH_NOTE,
    sessions: [reject, accept].map((s) => ({
      prompted: s.prompted,
      requests: s.requests.map((r) => ({
        method: r.method,
        host: r.host,
        path: r.path,
        fieldNames: [...r.fields.keys()],
        ...(r.body === null ? {} : { body: r.body }),
      })),
      socs: s.socs,
      socsBeforeChoice: s.socsBeforeChoice,
      hosts: [...s.hosts],
      ended: s.ended,
    })),
    differing,
  };
}

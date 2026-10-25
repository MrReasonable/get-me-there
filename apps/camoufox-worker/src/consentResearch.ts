import type { RequestLike } from './driver.js';

/**
 * Research 17.0c's recorder kind (spec §2 "Recordings first"; decision 74; brief WP17 Task 17.4): one run, two headed
 * sessions in throwaway profiles, the person clicking "Reject all" in the first and "Accept all" in the second. A request
 * listener keeps each consent-related request's method, host, path and form field names; values are held in memory only
 * until both sessions are over, compared, and dropped, except the one field whose value tells the two choices apart
 * (when exactly one does). The two sessions' SOCS cookies' fields are kept, so the rejection mark can be derived from
 * them. This module is pure; record.ts runs the sessions through the consent driver.
 */
/** One request as the listener holds it, values in memory only. */
export interface ObservedRequest {
  method: string;
  host: string;
  path: string;
  fields: ReadonlyMap<string, string>;
}

const RESEARCH_HOSTS = new Set(['consent.google.com', 'www.google.com']);

/**
 * A document navigation or a form POST to the consent host or the results host, its form fields parsed (URL-encoded
 * bodies only); null for anything else (subresources, other hosts). Never throws.
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
  let body: string | null = null;
  try {
    body = method === 'POST' ? (r.postData?.() ?? null) : null;
  } catch {
    body = null;
  }
  if (body !== null) for (const [k, v] of new URLSearchParams(body)) if (!fields.has(k)) fields.set(k, v);
  return { method, host: u.hostname, path: u.pathname, fields };
}

/** What one session left: its choice, its requests, the SOCS fields read after it, and how it ended. */
export interface ResearchSession {
  choice: 'reject' | 'accept';
  requests: readonly ObservedRequest[];
  socs: Readonly<Record<string, string | number | boolean>> | null;
  hosts: readonly string[];
  ended: string;
}

/** The record written: names everywhere, and the one differing value when exactly one field differs. */
export interface ResearchRecord {
  sessions: Array<{
    choice: 'reject' | 'accept';
    requests: Array<{ method: string; host: string; path: string; fieldNames: string[] }>;
    socs: Readonly<Record<string, string | number | boolean>> | null;
    hosts: string[];
    ended: string;
  }>;
  /** The field whose value differs between the two form submissions, with both values; or the names when not one. */
  differing: { name: string; reject: string; accept: string } | { names: string[] } | null;
}

const key = (r: ObservedRequest): string => `${r.method} ${r.host}${r.path}`;

/**
 * Pure: the two sessions as they are saved. Form submissions are matched by method, host and path; a field present in
 * both with different values is a difference. Exactly one: its two values are kept. More than one: only their names.
 */
export function researchRecord(reject: ResearchSession, accept: ResearchSession): ResearchRecord {
  const posts = (s: ResearchSession) => s.requests.filter((r) => r.method === 'POST' && r.fields.size > 0);
  const differs = new Map<string, { reject: string; accept: string }>();
  for (const a of posts(reject))
    for (const b of posts(accept)) {
      if (key(a) !== key(b)) continue;
      for (const [name, value] of a.fields) {
        const other = b.fields.get(name);
        if (other !== undefined && other !== value && !differs.has(name))
          differs.set(name, { reject: value, accept: other });
      }
    }
  const names = [...differs.keys()].sort();
  const only = names.length === 1 ? names[0] : undefined;
  const one = only === undefined ? undefined : differs.get(only);
  return {
    sessions: [reject, accept].map((s) => ({
      choice: s.choice,
      requests: s.requests.map((r) => ({
        method: r.method,
        host: r.host,
        path: r.path,
        fieldNames: [...r.fields.keys()],
      })),
      socs: s.socs,
      hosts: [...s.hosts],
      ended: s.ended,
    })),
    differing:
      only !== undefined && one !== undefined
        ? { name: only, reject: one.reject, accept: one.accept }
        : names.length > 1
          ? { names }
          : null,
  };
}

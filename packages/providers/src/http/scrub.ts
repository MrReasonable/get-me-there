import type { Secret } from '@gmt/core';
import { isRecord } from '../util.js';

const REDACTED = '[redacted]';

/** Origin + path only: no query, fragment or userinfo. Spec §5.3 "every URL written to any sink". */
export function stripUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '<url>';
  }
}

/**
 * Every textual form in which a secret can reach a sink (spec §5.3 "base64 and URL-encoded forms where feasible"):
 * raw, encodeURIComponent, URLSearchParams form-encoding, JSON string escaping, base64 (padded and not) and base64url.
 */
export function secretForms(value: string): string[] {
  if (value === '') return [];
  const b64 = Buffer.from(value, 'utf8').toString('base64');
  return [
    value,
    encodeURIComponent(value),
    new URLSearchParams({ v: value }).toString().slice(2),
    JSON.stringify(value).slice(1, -1),
    b64,
    b64.replace(/=+$/, ''),
    Buffer.from(value, 'utf8').toString('base64url'),
  ];
}

function formsOf(secrets: readonly Secret[]): string[] {
  const out = new Set<string>();
  for (const s of secrets) for (const f of secretForms(s.reveal())) out.add(f);
  // why: longest first, so a form that contains another is replaced whole.
  return [...out].sort((a, b) => b.length - a.length);
}

/** True when any secret, in any of its forms, occurs in `text`. */
export function containsSecret(text: string, secrets: readonly Secret[]): boolean {
  return formsOf(secrets).some((f) => text.includes(f));
}

/**
 * Deep copy of `value` with every secret occurrence (any form, in values and object keys) replaced by
 * `[redacted]`. Throws if a secret is still present afterwards. Spec §5.3: cache bodies, error messages and
 * returned bodies are scrubbed before any sink sees them.
 */
export function scrubSecrets<T>(value: T, secrets: readonly Secret[]): T;
// why: the implementation signature is wider so the structural copy needs no cast; the copy has the input's shape.
export function scrubSecrets(value: unknown, secrets: readonly Secret[]): unknown {
  const forms = formsOf(secrets);
  if (forms.length === 0) return value;
  const text = (s: string): string => forms.reduce((acc, f) => acc.split(f).join(REDACTED), s);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return text(v);
    if (Array.isArray(v)) return v.map(walk);
    if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [text(k), walk(x)]));
    return v;
  };
  const out = walk(value);
  const serialised = typeof out === 'string' ? out : (JSON.stringify(out) ?? '');
  if (containsSecret(serialised, secrets)) throw new Error('scrubSecrets: a secret survived scrubbing');
  return out;
}

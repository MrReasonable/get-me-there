import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Clock,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  isoDateTimeSchema,
  type StartConsent,
} from '@gmt/core';
import type { CookieInput, CookieLike } from './driver.js';

/**
 * Consent: rejected, never accepted (spec §2; decision 69 ruling 9; SEC-R2-001, TS2-06). Google's consent-choice
 * cookie is `SOCS` (Google's cookie policy, read 2026-10-18: "Google uses the 'SOCS' cookie, which lasts for 13
 * months, to store a user's state regarding their cookies choices"). Its value is undocumented and never invented: the
 * operator captures it once from a real "Reject all" in an ordinary private browser window (`capture-socs`), and the
 * worker sets it before every page and compares it by value after every page, on every path. `SOCS_STABLE` records only
 * that the stability recording passed; it never weakens the comparison.
 */
export const SOCS_NAME = 'SOCS';
export const SOCS_DOMAIN = '.google.com';
export const SOCS_FILE = 'socs.json';
/** The cookie's stated lifetime: a capture older than this is refused (TS-18: calendar months on the UTC date). */
export const SOCS_MAX_AGE_MONTHS = 13;

export interface SocsCapture {
  value: string;
  domain: '.google.com';
  path: '/';
  expires: number;
  secure: true;
  sameSite: 'Lax' | 'Strict' | 'None';
  capturedAt: IsoDateTime;
}

export class ConsentNotCaptured extends Error {
  constructor(why: string) {
    super(
      `SOCS capture refused (${why}); capture "Reject all" again with: pnpm --filter @gmt/camoufox-worker capture-socs`,
    );
    this.name = 'ConsentNotCaptured';
  }
}

const SAME_SITE = ['Lax', 'Strict', 'None'] as const;
function isSameSite(s: unknown): s is SocsCapture['sameSite'] {
  return SAME_SITE.some((x) => x === s);
}

/** The UTC calendar date `months` before `at`, clamped to the month's last day (2026-03-31 − 1 → 2026-02-28). */
export function monthsBefore(at: IsoDateTime, months: number): string {
  const d = new Date(at);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() - months;
  const target = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return target.toISOString().slice(0, 10);
}

/** A capture's fields, shape only (no date judged); throws ConsentNotCaptured naming what is wrong. */
export function parseCaptureShape(raw: unknown): SocsCapture {
  if (typeof raw !== 'object' || raw === null) throw new ConsentNotCaptured('not a JSON object');
  const get = (k: string): unknown => (k in raw ? Object.getOwnPropertyDescriptor(raw, k)?.value : undefined);
  const value = get('value');
  if (typeof value !== 'string' || value === '') throw new ConsentNotCaptured('an empty value');
  if (get('domain') !== SOCS_DOMAIN) throw new ConsentNotCaptured('the domain is not .google.com');
  if (get('path') !== '/') throw new ConsentNotCaptured('the path is not /');
  const expires = get('expires');
  if (typeof expires !== 'number' || !Number.isFinite(expires)) throw new ConsentNotCaptured('no expiry');
  if (get('secure') !== true) throw new ConsentNotCaptured('not Secure');
  const sameSite = get('sameSite');
  if (!isSameSite(sameSite)) throw new ConsentNotCaptured('no SameSite');
  const at = isoDateTimeSchema.safeParse(get('capturedAt'));
  if (!at.success) throw new ConsentNotCaptured('no capture time');
  return { value, domain: SOCS_DOMAIN, path: '/', expires, secure: true, sameSite, capturedAt: at.data };
}

/** Validates a parsed capture, its dates included; throws ConsentNotCaptured naming what is wrong. */
export function parseCapture(raw: unknown, clock: Clock): SocsCapture {
  const c = parseCaptureShape(raw);
  const now = clock.now();
  if (Date.parse(c.capturedAt) > Date.parse(now)) throw new ConsentNotCaptured('dated in the future');
  if (c.capturedAt.slice(0, 10) < monthsBefore(now, SOCS_MAX_AGE_MONTHS))
    throw new ConsentNotCaptured('older than 13 months, the cookie’s stated lifetime');
  // why: fix round 1 (prov-int M11): addCookies would drop an expired cookie and every page would stop as consent
  if (c.expires * 1000 <= Date.parse(now))
    throw new ConsentNotCaptured('the cookie has expired; run capture-socs again');
  return c;
}

/** Loads `<data>/socs.json`: present, 0600 (never group- or world-readable), valid and in date. */
export function loadSocs(dataDir: string, clock: Clock): SocsCapture {
  const file = join(dataDir, SOCS_FILE);
  let text: string;
  try {
    if ((statSync(file).mode & 0o077) !== 0)
      throw new ConsentNotCaptured('the file is readable by others; chmod 600');
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if (e instanceof ConsentNotCaptured) throw e;
    throw new ConsentNotCaptured('no capture file');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ConsentNotCaptured('not JSON');
  }
  return parseCapture(raw, clock);
}

/** What `capture-socs` reads from the operator: the cookie as the browser's cookie view shows it. */
export interface CaptureInput {
  value: string;
  expires: number;
  secure: boolean;
  sameSite: string;
}

/**
 * Writes the capture, stamped from the clock, with the domain and path fixed: the directory is created 0700 (an
 * existing one with a looser mode is refused, naming `chmod 700`) and the file written 0600, atomically.
 */
export function writeCapture(dataDir: string, input: CaptureInput, clock: Clock): SocsCapture {
  if (existsSync(dataDir)) {
    if ((statSync(dataDir).mode & 0o777) !== 0o700)
      throw new ConsentNotCaptured(`${dataDir} is not 0700; chmod 700 it`);
  } else mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const capture = parseCapture({ ...input, domain: SOCS_DOMAIN, path: '/', capturedAt: clock.now() }, clock);
  const file = join(dataDir, SOCS_FILE);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(capture), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  return capture;
}

/** The one cookie the worker ever sets (decision 69): SOCS with the captured attributes, nothing else. */
export function socsCookie(c: SocsCapture): CookieInput {
  return {
    name: SOCS_NAME,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires,
    secure: c.secure,
    sameSite: c.sameSite,
    httpOnly: false,
  };
}

export type ReadBack = 'same' | 'changed' | 'missing';

/** Every cookie domain the browser sends to www.google.com: the captured one and the host-only forms (sec M1). */
const SENT_TO_RESULTS_HOST: readonly string[] = [
  SOCS_DOMAIN,
  'google.com',
  'www.google.com',
  '.www.google.com',
];

/**
 * Ruling 9: `missing` when no SOCS is on `.google.com`; `changed` when any SOCS the browser would send to
 * www.google.com (the `.google.com` one or a host-only one, fix round 1 sec M1) holds another value; else `same`.
 * Both `changed` and `missing` stop the page, whatever SOCS_STABLE says.
 */
export function readBack(
  cookies: ReadonlyArray<Pick<CookieLike, 'name' | 'value' | 'domain'>>,
  capture: SocsCapture,
): ReadBack {
  const socs = cookies.filter((c) => c.name === SOCS_NAME);
  if (!socs.some((c) => c.domain === SOCS_DOMAIN)) return 'missing';
  const sent = socs.filter((c) => SENT_TO_RESULTS_HOST.includes(c.domain));
  return sent.every((c) => c.value === capture.value) ? 'same' : 'changed';
}

/** The UTC instant `months` calendar months after `at`, the day clamped to the month's last (2026-01-31 + 1 → 02-28). */
export function monthsAfter(at: IsoDateTime, months: number): IsoDateTime {
  const d = new Date(at);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  target.setUTCHours(d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
  return isoDateTimeOfEpochMs(target.getTime());
}

/**
 * The consent record in `<data>/socs.json` (spec §2 "Consent"; decision 74): a captured rejection (`socs`), whose
 * expiry is the earlier of the cookie's own and `capturedAt` + 13 months; a region with no consent screen
 * (`{ consent: "not-shown", checkedAt }`, expiring `checkedAt` + 13 months); or one voided because a consent screen
 * appeared later (`{ consent: "voided", voidedAt }`, no expiry).
 */
export type ConsentRecord =
  | { kind: 'socs'; capture: SocsCapture; expiresAt: IsoDateTime; boundedBy: 'cookie' | 'capture' }
  | { kind: 'not-shown'; checkedAt: IsoDateTime; expiresAt: IsoDateTime }
  | { kind: 'voided'; voidedAt: IsoDateTime };

/** A capture's expiry and what bounds it (the cookie's own expiry wins a tie). Pure. */
export function captureExpiry(c: Pick<SocsCapture, 'expires' | 'capturedAt'>): {
  expiresAt: IsoDateTime;
  boundedBy: 'cookie' | 'capture';
} {
  const cookie = c.expires * 1000;
  const capture = Date.parse(monthsAfter(c.capturedAt, SOCS_MAX_AGE_MONTHS));
  return cookie <= capture
    ? { expiresAt: isoDateTimeOfEpochMs(cookie), boundedBy: 'cookie' }
    : { expiresAt: isoDateTimeOfEpochMs(capture), boundedBy: 'capture' };
}

const RECORD_KINDS = ['not-shown', 'voided'] as const;

/**
 * Reads the consent record for the start checks and the status: null when there is none, 'invalid' when the file is
 * readable by others, unreadable, not JSON, of no known shape, or dated in the future. An expired record is returned
 * with its expiry, so the start says `consent-expired`, never `consent-missing`.
 */
export function readConsentRecord(dataDir: string, clock: Clock): ConsentRecord | null | 'invalid' {
  const file = join(dataDir, SOCS_FILE);
  if (!existsSync(file)) return null;
  let text: string;
  try {
    if ((statSync(file).mode & 0o077) !== 0) return 'invalid';
    text = readFileSync(file, 'utf8');
  } catch {
    // why: a file that is there but cannot be read is no record anyone can trust
    return 'invalid';
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return 'invalid';
  }
  if (typeof raw !== 'object' || raw === null) return 'invalid';
  const now = Date.parse(clock.now());
  const at = (k: string) =>
    isoDateTimeSchema.safeParse(k in raw ? Object.getOwnPropertyDescriptor(raw, k)?.value : undefined);
  const consent = 'consent' in raw ? raw.consent : undefined;
  if (consent !== undefined) {
    const kind = RECORD_KINDS.find((k) => k === consent);
    const keys = Object.keys(raw).sort().join(',');
    if (kind === 'not-shown') {
      const checked = at('checkedAt');
      if (keys !== 'checkedAt,consent' || !checked.success || Date.parse(checked.data) > now)
        return 'invalid';
      return {
        kind,
        checkedAt: checked.data,
        expiresAt: monthsAfter(checked.data, SOCS_MAX_AGE_MONTHS),
      };
    }
    if (kind === 'voided') {
      const voided = at('voidedAt');
      if (keys !== 'consent,voidedAt' || !voided.success) return 'invalid';
      return { kind, voidedAt: voided.data };
    }
    return 'invalid';
  }
  let capture: SocsCapture;
  try {
    // why: the dates are judged by the expiry below, so a stale capture reads as expired, not as missing
    capture = parseCaptureShape(raw);
  } catch {
    return 'invalid';
  }
  if (Date.parse(capture.capturedAt) > now) return 'invalid';
  return { kind: 'socs', capture, ...captureExpiry(capture) };
}

/** The start checks' view of a record (core's StartConsent): a voided record has no expiry. */
export function startConsentOf(r: ConsentRecord | null | 'invalid'): StartConsent | null {
  if (r === null || r === 'invalid') return null;
  return r.kind === 'voided' ? { kind: 'voided' } : { kind: r.kind, expiresAt: r.expiresAt };
}

/** `/v1/status`'s consent field: the kind, its expiry and what bounds it (null for a voided record). */
export function consentStatusOf(r: ConsentRecord): {
  kind: ConsentRecord['kind'];
  expiresAt: IsoDateTime | null;
  boundedBy: 'cookie' | 'capture' | 'check' | null;
} {
  if (r.kind === 'voided') return { kind: 'voided', expiresAt: null, boundedBy: null };
  if (r.kind === 'not-shown') return { kind: 'not-shown', expiresAt: r.expiresAt, boundedBy: 'check' };
  return { kind: 'socs', expiresAt: r.expiresAt, boundedBy: r.boundedBy };
}

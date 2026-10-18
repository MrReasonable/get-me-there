import type { Clock, IsoDateTime } from '@gmt/core';
import type { ContextLike, CookieLike } from './driver.js';

/**
 * The account-cookie check (spec §2 "The worker's own, signed-out profile"; brief §6; decision 69 round 2, item 8;
 * PIE-R2-08, SEC-R2-002). Dated 2026-10-18: Google's session and sign-in cookie names, read across every `google.com`
 * domain (both `https://www.google.com` and `https://accounts.google.com`) with one `context.cookies()` call and no URL
 * argument. The profile is signed in when any of these names is present, or when any cookie at all is host-only on
 * `accounts.google.com`. Only names are read; a value never leaves this module.
 */
export const ACCOUNT_COOKIES_DATED = '2026-10-18';
export const ACCOUNT_COOKIE_NAMES: readonly string[] = [
  'SID',
  'HSID',
  'SSID',
  'APISID',
  'SAPISID',
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Secure-1PAPISID',
  '__Secure-3PAPISID',
  '__Secure-1PSIDTS',
  '__Secure-3PSIDTS',
  '__Secure-1PSIDCC',
  '__Secure-3PSIDCC',
  'SIDCC',
  'LSID',
  '__Host-1PLSID',
  '__Host-3PLSID',
  '__Host-GAPS',
  'OSID',
  '__Secure-OSID',
  'ACCOUNT_CHOOSER',
];
const ACCOUNTS_HOST = 'accounts.google.com';

/** True for `google.com` itself and every subdomain, with or without the leading dot of a domain cookie. */
function onGoogle(domain: string): boolean {
  const d = domain.startsWith('.') ? domain.slice(1) : domain;
  return d === 'google.com' || d.endsWith('.google.com');
}

export interface AccountCookieResult {
  found: boolean;
  /** The offending cookie names (never values), sorted and unique. */
  names: string[];
}

/** The pure rule over a cookie list (names and domains only). */
export function accountCookiesIn(
  cookies: ReadonlyArray<Pick<CookieLike, 'name' | 'domain'>>,
): AccountCookieResult {
  const names = new Set<string>();
  for (const c of cookies) {
    if (!onGoogle(c.domain)) continue;
    // why: a host-only cookie has no leading dot; any of them on the sign-in host means a sign-in happened.
    if (ACCOUNT_COOKIE_NAMES.includes(c.name) || c.domain === ACCOUNTS_HOST) names.add(c.name);
  }
  const list = [...names].sort();
  return { found: list.length > 0, names: list };
}

/** Reads the context's cookies (no URL argument, so every domain) and applies the rule, stamped with the clock. */
export async function checkAccountCookies(
  context: Pick<ContextLike, 'cookies'>,
  clock: Clock,
): Promise<AccountCookieResult & { checkedAt: IsoDateTime }> {
  const cookies = await context.cookies();
  return { ...accountCookiesIn(cookies), checkedAt: clock.now() };
}

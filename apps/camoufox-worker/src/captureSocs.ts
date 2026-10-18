import { createInterface } from 'node:readline/promises';
import { type Clock, systemClock } from '@gmt/core';
import { type Entry, type EntryContext, EX_CONFIG } from './run.js';
import { ConsentNotCaptured, writeCapture } from './socs.js';

/**
 * `capture-socs` (spec §2 "Consent"; brief Tasks 14.2 and 14.12; devops-010): the operator opens
 * https://www.google.com/travel/flights in an ordinary private browser window, clicks "Reject all", opens the cookie
 * view for https://www.google.com and pastes the SOCS cookie's value, expiry, Secure and SameSite here. The command
 * stamps the time, fixes the domain (.google.com) and path (/), and writes `<data>/socs.json` 0600. It never prints
 * the value.
 */
export type Ask = (question: string) => Promise<string>;

/** An expiry as a browser's cookie view shows it: epoch seconds, or a date it can parse ("2027-11-20T10:00:00.000Z"). */
export function parseExpiry(raw: string): number | null {
  const t = raw.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Math.floor(Number(t));
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}
const yes = (raw: string): boolean => /^(y|yes|true|✓|1)$/i.test(raw.trim());
function sameSiteOf(raw: string): string {
  const t = raw.trim().toLowerCase();
  return t === 'lax'
    ? 'Lax'
    : t === 'strict'
      ? 'Strict'
      : t === 'none' || t === 'no_restriction'
        ? 'None'
        : raw.trim();
}

export async function captureSocs(ctx: EntryContext, ask: Ask, clock: Clock): Promise<number> {
  try {
    const value = (await ask('SOCS value (from the cookie view, after "Reject all"): ')).trim();
    const expiresRaw = await ask('Expires (as the cookie view shows it): ');
    const secure = yes(await ask('Secure? (y/n): '));
    const sameSite = sameSiteOf(await ask('SameSite (Lax, Strict or None): '));
    const expires = parseExpiry(expiresRaw);
    if (expires === null) throw new ConsentNotCaptured('the expiry could not be read');
    if (expires * 1000 <= Date.parse(clock.now()))
      throw new ConsentNotCaptured('the cookie has already expired');
    const c = writeCapture(ctx.dataDir, { value, expires, secure, sameSite }, clock);
    ctx.out(
      `captured SOCS at ${c.capturedAt} (${c.sameSite}, expires ${new Date(c.expires * 1000).toISOString()}); written 0600`,
    );
    return 0;
  } catch (e) {
    ctx.err(e instanceof Error ? e.message : String(e));
    return EX_CONFIG;
  }
}

/** The command: asks on the terminal. */
export const entry: Entry = async (ctx) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await captureSocs(ctx, (q) => rl.question(q), systemClock);
  } finally {
    rl.close();
  }
};

import { ECB_CURRENCIES, type IsoDate, isoDateSchema, ProviderError } from '@gmt/core';
import { z } from 'zod';
import type { EngineContext } from '../context.js';
import { FX_SOURCE } from '../normalise.js';

/**
 * frankfurter's latest ECB reference rates against GBP. Verified 2026-10-14: the `.app` host answers 301 to this URL,
 * and http-kit sends `redirect: 'error'`, so the engine calls `.dev/v1` directly and the `fx` host allowlist is
 * `api.frankfurter.dev` (plan decision 2). Body: `{ amount, base, date, rates }` where `rates[C]` is units of C per `amount`
 * GBP; the schema pins `amount` to 1, which the stored rate assumes (prov M2).
 */
export const FRANKFURTER_LATEST_URL = 'https://api.frankfurter.dev/v1/latest?from=GBP';

const frankfurterSchema = z.object({
  amount: z.literal(1),
  base: z.literal('GBP'),
  date: isoDateSchema,
  rates: z.record(z.string(), z.number().positive().finite()),
});

/** Validates the frankfurter body with zod; anything else is a `parse` error (no rates stored). */
export function parseFrankfurter(
  body: unknown,
): { date: IsoDate; rates: Record<string, number> } | ProviderError {
  const r = frankfurterSchema.safeParse(body);
  if (!r.success) {
    const where = r.error.issues.map((i) => i.path.join('.') || 'body').join(', ');
    return new ProviderError({
      kind: 'parse',
      retryable: false,
      providerId: 'fx',
      message: `frankfurter: unexpected body at ${where}`,
    });
  }
  return { date: r.data.date, rates: r.data.rates };
}

/**
 * Daily FX refresh (spec §5.6 "refreshed daily"). Goes through http-kit under the id `fx` (spec §5.3 rev 10): limiter,
 * host allowlist, timeout and retry apply; it is never ledgered and never reserved. Stores `fx_rate_nano` = GBP per 1
 * native unit × 1e9 for ECB currencies only (spec §6.3). A failure throws the ProviderError and stores nothing.
 */
export async function refreshFx(
  ctx: Pick<EngineContext, 'http' | 'repos' | 'log'>,
  signal: AbortSignal,
): Promise<{ date: IsoDate; stored: number }> {
  const res = await ctx.http.request({
    providerId: 'fx',
    executionId: null,
    tileIndex: null,
    endpointPath: '/v1/latest',
    method: 'GET',
    url: new URL(FRANKFURTER_LATEST_URL),
    headers: { accept: 'application/json' },
    cache: 'never',
    signal,
    recordFixtures: false,
  });
  const parsed = parseFrankfurter(res.body);
  if (parsed instanceof ProviderError) throw parsed;
  const rows: Array<{ date: IsoDate; currency: string; rateNano: number; source: string }> = [];
  for (const c of ECB_CURRENCIES) {
    const perGbp = parsed.rates[c];
    // why: the vendor gives units of C per GBP; the store wants GBP per unit of C, as an integer nano (spec §6.3)
    if (c !== 'GBP' && perGbp !== undefined)
      rows.push({ date: parsed.date, currency: c, rateNano: Math.round(1e9 / perGbp), source: FX_SOURCE });
  }
  ctx.repos.fx.upsert(rows);
  ctx.log.info({ fxDate: parsed.date, stored: rows.length }, 'fx: rates refreshed');
  return { date: parsed.date, stored: rows.length };
}

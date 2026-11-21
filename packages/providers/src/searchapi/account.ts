/**
 * SearchApi's own balance (settings plan ruling 10): `GET /api/v1/me` with the key as a Bearer header, under the
 * unledgered `searchapi-account` id, so it writes no ledger row, takes no reservation and works once the local cap is
 * spent. The read gives `account.remaining_searches` (SearchApi's name for what the app calls credits),
 * `account.monthly_allowance` (0 on the trial) and, only when the account has a subscription, `subscription.period_end`
 * (an ISO instant, shown as a date in the operator's zone). A key SearchApi refuses, an answer that cannot be read, a
 * timeout or no answer at all give `null`: the balance is a courtesy, never a reason to stop anything. An abort of the
 * caller's signal propagates.
 */
import {
  AbortedError,
  dateIn,
  type Logger,
  ProviderError,
  type SearchApiAccount,
  type Secret,
} from '@gmt/core';
import { z } from 'zod';
import type { HttpKit } from '../http/types.js';
import { authHeaders, SEARCHAPI_ACCOUNT_PATH, SEARCHAPI_HOST } from './params.js';

const credits = z.number().int().min(0);
/** The documented account shape, only the names this app reads; the vendor's other names pass. */
const accountBodySchema = z.object({
  account: z.object({ remaining_searches: credits, monthly_allowance: credits }),
  subscription: z.object({ period_end: z.iso.datetime() }).optional(),
});

export async function searchApiAccount(
  http: HttpKit,
  key: Secret,
  o: { timezone: string; log: Logger; signal: AbortSignal },
): Promise<SearchApiAccount | null> {
  let res: Awaited<ReturnType<HttpKit['request']>>;
  try {
    res = await http.request({
      providerId: 'searchapi-account',
      executionId: null,
      tileIndex: null,
      endpointPath: SEARCHAPI_ACCOUNT_PATH,
      method: 'GET',
      url: new URL(`https://${SEARCHAPI_HOST}${SEARCHAPI_ACCOUNT_PATH}`),
      headers: authHeaders(key),
      cache: 'never',
      signal: o.signal,
      recordFixtures: false,
    });
  } catch (e) {
    if (e instanceof AbortedError) throw e;
    // why: the error's class only; no message, so no part of the request can reach the line
    o.log.warn(
      {
        kind: e instanceof ProviderError ? e.kind : 'unknown',
        httpStatus: e instanceof ProviderError ? (e.httpStatus ?? null) : null,
      },
      'searchapi: the account balance could not be read',
    );
    return null;
  }
  const body = accountBodySchema.safeParse(res.body);
  if (!body.success) {
    o.log.warn({ kind: 'unreadable' }, 'searchapi: the account balance answer could not be read');
    return null;
  }
  const { account, subscription } = body.data;
  return {
    remaining: account.remaining_searches,
    monthlyAllowance: account.monthly_allowance,
    periodEnd: subscription === undefined ? null : dateIn(subscription.period_end, o.timezone),
    fetchedAt: res.fetchedAt,
  };
}

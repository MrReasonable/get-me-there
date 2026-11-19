import { budgetScopeLabel, type SearchApiAccount } from '@gmt/core';
import { useBudget, useSearchApiAccount } from '../api/queries.js';
import type { BudgetResponse, ProvidersResponse } from '../api/types.js';
import { COPY } from '../copy.js';
import { formatIsoDateShort, londonParts } from '../format.js';

const T = COPY.topBar;

/** A balance read longer ago than this is shown with the time it was read (settings plan ruling 10). */
export const CREDITS_FRESH_MS = 10 * 60 * 1000;

/**
 * SearchApi's credits left, worded once for every caller (settings plan ruling 10): the top bar, the new-search panel's
 * "Where to look", the search form's field. `line` is the whole sentence ("SearchApi: 38 credits left · resets 1 Dec");
 * `left` and `tail` are its figure and what follows it, for a caller that words the figure in its own sentence; `cap` is
 * the local cap the figure counts against when it is this app's own count, null for SearchApi's balance.
 */
export interface CreditsLine {
  left: number;
  cap: number | null;
  tail: string;
  line: string;
}

/**
 * SearchApi's own balance when it was read: its credits left, "· resets 1 Dec" on a monthly plan and "· as of 14:05"
 * once the read is older than ten minutes. When it was not (no answer, no key to ask with), this app's count of the
 * window in use, "51 of 100 credits left (this app's count)", which the local cap, still the hard stop, is judged by.
 *
 * Null when there is nothing honest to say: SearchApi is absent or not enabled, or the balance was not read and the
 * window's usage is not in the budget read or has no cap (a null cap means none is configured, never "unlimited").
 * `nowMs` is the instant the age is judged at; callers pass the clock they have.
 */
export function searchApiCreditsLine(
  account: SearchApiAccount | null,
  budget: Pick<BudgetResponse, 'scopes'>,
  providers: Pick<ProvidersResponse, 'providers'>,
  nowMs: number = Date.now(),
): CreditsLine | null {
  const provider = providers.providers.find((p) => p.providerId === 'searchapi');
  if (provider === undefined || !provider.enabled) return null;
  if (account !== null) {
    const readAt = Date.parse(account.fetchedAt);
    const parts = [
      ...(account.periodEnd === null ? [] : [T.creditsResets(formatIsoDateShort(account.periodEnd))]),
      ...(nowMs - readAt > CREDITS_FRESH_MS ? [T.creditsAsOf(londonParts(readAt).time)] : []),
    ];
    const tail = parts.map((p) => `· ${p}`).join(' ');
    return wording(account.remaining, null, tail);
  }
  // why: only the trial's allowance is a lifetime window; every other plan counts calls in the month (the api sends
  // only the window in use, but the plan, not the scopes present, says which one that is)
  const label = budgetScopeLabel({
    kind: provider.plan === 'trial' ? 'provider-lifetime' : 'provider-month',
    providerId: 'searchapi',
  });
  const usage = budget.scopes.find((u) => u.scope === label);
  if (usage === undefined || usage.cap === null) return null;
  return wording(Math.max(0, usage.cap - usage.calls), usage.cap, T.creditsLocalTail);
}

function wording(left: number, cap: number | null, tail: string): CreditsLine {
  const head = T.creditsLeft(left, cap);
  return { left, cap, tail, line: tail === '' ? head : `${head} ${tail}` };
}

/**
 * The line for the views that show it: the budget and SearchApi's own balance, read once for the page (the api caches
 * the balance ten minutes) and worded by `searchApiCreditsLine`. Null until both have answered; a balance read that
 * fails is not a reason to wait, it is the "this app's count" wording.
 */
export function useSearchApiCredits(providers: ProvidersResponse | undefined): CreditsLine | null {
  const budget = useBudget();
  const account = useSearchApiAccount();
  if (budget.data === undefined || providers === undefined || account.isPending) return null;
  return searchApiCreditsLine(account.data?.account ?? null, budget.data, providers);
}

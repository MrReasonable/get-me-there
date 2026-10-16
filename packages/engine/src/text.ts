import {
  type BudgetScopeKind,
  formatPence,
  type IsoDateTime,
  microGbpToPence,
  type ProviderId,
} from '@gmt/core';

// Operator-facing wording shared by notices and refusal messages (spec §8.1 "409 naming the cap and numbers"):
// money through core's formatPence, call scopes as counts, scopes in plain English, instants in local time.

/** True for the scopes whose figures are micro-GBP; the others count calls. */
export function isCostScope(scope: BudgetScopeKind): boolean {
  return scope === 'execution-cost' || scope === 'global-month';
}

/** Plain-English name of a cap scope (po-012). */
export function scopeName(scope: BudgetScopeKind, providerId: ProviderId | null): string {
  const p = providerId ?? 'the provider';
  switch (scope) {
    case 'execution-calls':
      return "this run's billed-call cap";
    case 'execution-free-calls':
      return "this run's free-call cap";
    case 'execution-cost':
      return "this run's spend cap";
    case 'provider-month':
      return `${p}'s monthly call cap`;
    case 'provider-lifetime':
      return `${p}'s lifetime call cap`;
    case 'global-month':
      return 'the monthly spend cap';
  }
}

/** A cap figure with its unit: pounds for cost scopes (micro-GBP rounded up to the penny), "N calls" otherwise (arch-018). */
export function scopeAmount(scope: BudgetScopeKind, n: number): string {
  if (isCostScope(scope)) return formatPence(microGbpToPence(n));
  return `${n} ${n === 1 ? 'call' : 'calls'}`;
}

/** "this run's billed-call cap is 50 calls; 50 calls used; the next call needs 1 call" in one sentence. */
export function breachText(
  scope: BudgetScopeKind,
  providerId: ProviderId | null,
  cap: number,
  used: number,
  needs: number,
  needsLabel: string,
): string {
  return `${scopeName(scope, providerId)} is ${scopeAmount(scope, cap)}; ${scopeAmount(scope, used)} used; ${needsLabel} ${scopeAmount(scope, needs)}`;
}

/** An instant as a readable local date and time in `tz`, e.g. "Mon 19 Oct 2026, 05:00 (Europe/London)" (po-015). */
export function formatInstant(at: IsoDateTime, tz: string): string {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return `${f.format(new Date(at))} (${tz})`;
}

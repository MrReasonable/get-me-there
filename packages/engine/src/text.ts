import {
  type BudgetExceeded,
  type BudgetScopeKind,
  formatPence,
  type IsoDateTime,
  microGbpToPence,
  type ProviderId,
  stripControlChars,
} from '@gmt/core';

// Operator-facing wording shared by notices and refusal messages (spec §8.1 "409 naming the cap and numbers"):
// money through core's formatPence, call scopes as counts, scopes in plain English, instants in local time.

/** True for the scopes whose figures are micro-GBP; the others count calls. */
export function isCostScope(scope: BudgetScopeKind): boolean {
  return scope === 'execution-cost' || scope === 'global-month';
}

/** The unit a cap counts: calls (or money) by default; a camoufox grid page's scrolls (spec §2 rev 34). */
export type CapUnit = 'calls' | 'scrolls';

/** Plain-English name of a cap scope (po-012); a scroll cap is named as one (fix round 1, CA 2). */
export function scopeName(
  scope: BudgetScopeKind,
  providerId: ProviderId | null,
  unit: CapUnit = 'calls',
): string {
  const p = providerId ?? 'the provider';
  if (unit === 'scrolls')
    return scope === 'provider-execution' ? `${p}'s scroll cap for this run` : `${p}'s monthly scroll cap`;
  switch (scope) {
    case 'execution-calls':
      return "this run's billed-call cap";
    case 'execution-free-calls':
      return "this run's free-call cap";
    case 'execution-cost':
      return "this run's spend cap";
    case 'provider-execution':
      return `${p}'s page cap for this run`;
    case 'provider-month':
      return `${p}'s monthly call cap`;
    case 'provider-lifetime':
      return `${p}'s lifetime call cap`;
    case 'global-month':
      return 'the monthly spend cap';
  }
}

/** A cap figure with its unit: pounds for cost scopes (micro-GBP rounded up to the penny), "N calls" otherwise (arch-018). */
export function scopeAmount(scope: BudgetScopeKind, n: number, unit: CapUnit = 'calls'): string {
  if (unit === 'scrolls') return `${n} ${n === 1 ? 'scroll' : 'scrolls'}`;
  if (isCostScope(scope)) return formatPence(microGbpToPence(n));
  return `${n} ${n === 1 ? 'call' : 'calls'}`;
}

/**
 * A BudgetExceeded in one sentence: breachText for this app's own caps; for the browser worker's own monthly caps
 * (decision 82; W3), named as the worker's, counting every app and recording that uses it, with the worker's figures.
 */
export function budgetText(e: BudgetExceeded, needsLabel: string): string {
  if (e.counter !== 'worker')
    return breachText(
      e.scope,
      e.providerId ?? null,
      e.cap,
      e.current,
      e.requested,
      needsLabel,
      e.unit ?? 'calls',
    );
  const unit = e.unit === 'scrolls' ? 'scrolls' : 'pages';
  return `the browser worker's monthly ${unit === 'scrolls' ? 'scroll' : 'page'} cap, counting every app and recording that uses it, is ${e.cap.toLocaleString('en-GB')} ${unit}; the worker counts ${e.current.toLocaleString('en-GB')} ${unit} used`;
}

/** "this run's billed-call cap is 50 calls; 50 calls used; the next call needs 1 call" in one sentence. */
export function breachText(
  scope: BudgetScopeKind,
  providerId: ProviderId | null,
  cap: number,
  used: number,
  needs: number,
  needsLabel: string,
  unit: CapUnit = 'calls',
): string {
  // why: a scroll cap is reached by a page's planned scrolls, so the figure that did not fit is the next page's
  const label = unit === 'scrolls' ? needsLabel.replace(/\bcall\b/, 'page') : needsLabel;
  return `${scopeName(scope, providerId, unit)} is ${scopeAmount(scope, cap, unit)}; ${scopeAmount(scope, used, unit)} used; ${label} ${scopeAmount(scope, needs, unit)}`;
}

/**
 * Unicode format characters that reorder or hide text in a plain-text mail client (sec-007): the soft hyphen, the
 * Arabic letter mark, the Mongolian vowel separator, the zero-width space, joiners and directional marks
 * (U+200B–U+200F), the bidi embeddings and overrides (U+202A–U+202E), the invisible operators (U+2060–U+2064), the
 * bidi isolates and deprecated format controls (U+2066–U+206F) and the byte-order mark. Removed, not replaced: they
 * have no width, so a space would add one.
 */
function isHiddenFormat(code: number): boolean {
  return (
    code === 0x00ad ||
    code === 0x061c ||
    code === 0x180e ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x2066 && code <= 0x206f) ||
    code === 0xfeff
  );
}

/**
 * Text with no character that can start a header or a line, or reorder or hide text: every control character (core's
 * stripControlChars, the Unicode Cc set: C0, U+007F, C1; decision 21) and the line and paragraph separators
 * (U+2028, U+2029) become a space, one for one; the format characters of isHiddenFormat are removed. No trimming, so a
 * body line keeps its indentation. The one cleaner of the engine (spec §8.3): the email templates, the EmailNotifier
 * and the operator templates' cleanLine all use it.
 */
export function controlFree(s: string): string {
  let out = '';
  for (const ch of stripControlChars(s, ' ')) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x2028 || code === 0x2029) out += ' ';
    else if (!isHiddenFormat(code)) out += ch;
  }
  return out;
}

/**
 * One line of provider-supplied text: controlFree, runs of spaces collapsed, trimmed. Spec §8.3: provider strings are
 * CRLF/control-stripped, so none can start a header or a line. URLs are left whole: validated links keep their query
 * in email (decision 10); the operator templates strip them first.
 */
export function stripControl(s: string): string {
  return controlFree(s).replace(/ {2,}/g, ' ').trim();
}

import { type OperatorMessageKind, stripControlChars, stripUrlsInText } from '@gmt/core';

// why: spec §11 banned words apply to engine templates; every string here is covered by the banned-word test in
// notifications.test.ts and the runtime sweep of Task 7.20. "Budget cap" covers call caps and spend caps alike; the
// detail line names which one and its figures (po-015).
const SUBJECTS: Readonly<Record<OperatorMessageKind, string>> = {
  paused_budget: 'run paused: a budget cap was reached',
  paused_error: 'run paused after errors',
  skipped_budget: 'scheduled run skipped: it would exceed a budget cap',
  skipped_confirm: 'scheduled run skipped: the cost estimate needs your confirmation',
  skipped_window: 'scheduled run skipped: the window has no departure dates left, schedule disabled',
  skipped_missed: 'scheduled run missed while the app was stopped',
  interrupted: 'run interrupted',
  provider_disabled: 'a provider was disabled for this run',
  provider_capped: 'a provider reached a budget cap; the others carried on',
  crash_loop: 'automatic resume stopped after repeated restarts',
  parity_break: 'request count differs from the plan',
  alerts_calendar_only: 'alerts running on calendar basis only',
};
/** The keys of a record keyed by a string union, typed as that union (for…in over a Record<K, …> yields K). */
function keysOf<K extends string>(r: Readonly<Record<K, unknown>>): K[] {
  const out: K[] = [];
  for (const k in r) out.push(k);
  return out;
}

/**
 * Every operator-notification kind of spec §8.1 "Operator notifications" (core's OperatorMessageKind), read from
 * SUBJECTS, which the compiler makes name every kind; so a new kind can never be missing here, and the banned-word
 * sweeps that iterate this list never skip one (code-architect review 13).
 */
export const OPERATOR_KINDS: readonly OperatorMessageKind[] = keysOf(SUBJECTS);

const GUIDANCE: Readonly<Record<OperatorMessageKind, string>> = {
  paused_budget:
    'Raise the cap, or wait for the automatic resume if the line above names one; Resume is on the status bar.',
  paused_error: 'Check the provider, then resume from the status bar once the cause is fixed.',
  skipped_budget: 'Lower maxCells, run less often, or raise the cap.',
  skipped_confirm: 'Open the definition and confirm the new estimate.',
  skipped_window: 'Edit the window, then enable the definition again.',
  skipped_missed: 'The next scheduled run goes ahead as normal; start one now if you need newer prices.',
  interrupted:
    'With AUTO_RESUME on it resumes on the next start unless it has restarted too often without progress, or is older than its discovery refresh allows (then it is cancelled and the next run starts with fresh prices); otherwise resume it from the status bar.',
  provider_disabled: 'The other providers carried on; a manual resume retries this one.',
  provider_capped:
    'Its cells stay skipped (budget) in this run: resume the run by hand once the cap window reopens or the cap is raised, or the next scheduled run searches them.',
  crash_loop: 'Check the logs for the cause, then resume it manually from the status bar.',
  parity_break: 'The plan and the ledger disagree; Coverage shows both counts.',
  alerts_calendar_only:
    'Cells skipped for budget had no itinerary search, so verified-basis rules could not judge them; calendar-basis rules ran, constraints not checked.',
};
/** A scheduled run no configured provider can run is a configuration problem, not a spend one (po-003). */
const NO_RUNNABLE_PROVIDER = {
  subject: 'scheduled run skipped: no configured provider can run it',
  guidance: 'Configure a provider for this definition, or move it to a plan that allows scheduled runs.',
} as const;

/**
 * One line of provider- or operator-supplied text: URL query and userinfo stripped, every control character (C0 and
 * C1, core's stripControlChars, decision 21) → a space, runs of spaces collapsed (spec §5.3, §8.3).
 */
export function cleanLine(s: string): string {
  return stripControlChars(stripUrlsInText(s), ' ').replace(/ {2,}/g, ' ').trim();
}
/** Multi-line text: each line cleaned, line breaks kept. */
export function cleanText(s: string): string {
  return s.split('\n').map(cleanLine).join('\n');
}

/** What a template needs; `variant` picks the no-runnable-provider wording of skipped_budget. */
export interface MessageParams {
  definitionName: string;
  executionId: string | null;
  detail: string;
  variant?: 'no-runnable-provider';
}

/** Plain-text subject and body for an operator notification (spec §8.3 "Plain text only"). */
export function renderOperatorMessage(
  kind: OperatorMessageKind,
  p: MessageParams,
): { subject: string; body: string } {
  const noProvider = kind === 'skipped_budget' && p.variant === 'no-runnable-provider';
  const subject = `[get-me-there] ${cleanLine(p.definitionName)}: ${noProvider ? NO_RUNNABLE_PROVIDER.subject : SUBJECTS[kind]}`;
  const lines = [cleanText(p.detail), noProvider ? NO_RUNNABLE_PROVIDER.guidance : GUIDANCE[kind]];
  if (p.executionId !== null) lines.push(`Execution: ${p.executionId}`);
  return { subject, body: lines.join('\n') };
}

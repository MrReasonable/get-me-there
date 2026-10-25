/**
 * The camoufox worker's start (decision 76): why it may refuse, the refusal file, the words for each refusal, and the
 * pure start checks. WP17's worker decides its start with `startChecks`; WP16b's status, WP17's start and update and
 * WP18's status report read the same reasons and words, so no two of them can disagree.
 */
import { z } from 'zod';
import { type IsoDateTime, isoDateTimeSchema } from '../types/ids.js';
import { CAMOUFOX_BUILDS, flagsFor, type OsArch } from './builds.js';
import { CONSENT_FIX } from './consentFix.js';

/** The refusal file's name inside the worker's data directory: a contract between the worker, the CLI and the app. */
export const START_REFUSAL_FILE = 'start-refusal.json';

/** Why the worker refused to start, written to `<workerData>/start-refusal.json` with the instant. */
export const START_REFUSAL_REASONS = [
  'flags-unset',
  'consent-missing',
  'consent-expired',
  'consent-voided',
  'consent-not-shown',
  'build-mismatch',
  'layout',
  'signed-in',
  'locked',
  'counts-missing',
  'counts-unreadable',
  'config',
] as const;
export type StartRefusalReason = (typeof START_REFUSAL_REASONS)[number];
/** The refusal file: a reason and when; any other field (a fix text above all) is refused, never shown. */
export const startRefusalSchema = z.strictObject({
  reason: z.enum(START_REFUSAL_REASONS),
  at: isoDateTimeSchema,
});
export type StartRefusal = z.infer<typeof startRefusalSchema>;

/**
 * The one map from a refusal to its words: WP16b's local status, WP17's start and update, and WP18's status builder
 * all read it. A fix is a `pnpm …` command that exists today (W1, W2), or null where nothing the operator runs fixes it
 * (a build or its flags awaiting verification, which WP18 shows as off).
 */
export const START_REFUSAL_TEXT: Readonly<
  Record<StartRefusalReason, { summary: string; fixCommand: `pnpm ${string}` | null }>
> = {
  'flags-unset': { summary: 'this machine has no verified browser build yet', fixCommand: null },
  'consent-missing': { summary: 'no consent record: capture one', fixCommand: CONSENT_FIX.command },
  'consent-expired': {
    summary: 'the consent record has expired: capture again',
    fixCommand: CONSENT_FIX.command,
  },
  'consent-voided': { summary: 'consent screen now shown: capture again', fixCommand: CONSENT_FIX.command },
  'consent-not-shown': {
    summary:
      'the consent record says no consent page was shown; this worker needs a captured rejection: capture one',
    fixCommand: CONSENT_FIX.command,
  },
  'build-mismatch': {
    summary: 'the installed browser build is not the pinned one',
    fixCommand: 'pnpm gmt browser install',
  },
  layout: {
    summary: 'the browser install is incomplete or has changed',
    fixCommand: 'pnpm gmt browser install',
  },
  'signed-in': {
    summary: 'the browser profile is signed in to an account: clear it',
    fixCommand: 'pnpm --filter @gmt/camoufox-worker clear-signed-in',
  },
  locked: { summary: 'another worker holds the lock', fixCommand: 'pnpm gmt restart' },
  'counts-missing': {
    summary:
      'the monthly counts file is missing beside an earlier worker’s files: rewrite it from the ledger',
    fixCommand: 'pnpm gmt browser counts',
  },
  'counts-unreadable': {
    summary: 'the monthly counts file cannot be read: rewrite it from the ledger',
    fixCommand: 'pnpm gmt browser counts',
  },
  config: {
    summary: 'the worker’s settings or files were refused (pnpm gmt start prints the worker’s own reason)',
    fixCommand: 'pnpm gmt start',
  },
};

/**
 * The worker's consent record as the start reads it (review R31): a voided record has no expiry, so the type gives it
 * none; a captured (`socs`) or never-shown (`not-shown`) record has its own `expiresAt`.
 */
export type StartConsent = { kind: 'voided' } | { kind: 'socs' | 'not-shown'; expiresAt: IsoDateTime };

/** What the worker's start knows about its machine, its install, its consent record, its profile and its lock. */
export interface StartFacts {
  /** The monthly counts file (decision 82): fine, missing beside an earlier worker's pacer file, or unreadable. */
  counts: 'ok' | 'missing' | 'unreadable';
  /** null on a machine no build is pinned for. */
  osArch: OsArch | null;
  installedBuild: string | null;
  layoutOk: boolean;
  consent: StartConsent | null;
  signedIn: boolean;
  locked: boolean;
  now: IsoDateTime;
}

/**
 * Whether the worker may start, as the first refusal in this order, or null: another worker holds the lock; the
 * machine's pinned build has no verified search form (FORM_VERIFIED, the one check every page needs); the install's
 * layout is broken; the installed build is not the pinned one; the profile is signed in; no consent record; a voided
 * one (the consent screen is shown again); an expired one (its own `expiresAt`, at or before now); a never-shown one;
 * the monthly counts file missing or unreadable. `config` is the worker's own (its settings refused before any fact).
 * Pure.
 */
export function startChecks(f: StartFacts): StartRefusalReason | null {
  if (f.locked) return 'locked';
  if (f.osArch === null || !flagsFor(f.osArch, CAMOUFOX_BUILDS[f.osArch].build).FORM_VERIFIED)
    return 'flags-unset';
  if (!f.layoutOk) return 'layout';
  if (f.installedBuild !== CAMOUFOX_BUILDS[f.osArch].build) return 'build-mismatch';
  if (f.signedIn) return 'signed-in';
  if (f.consent === null) return 'consent-missing';
  if (f.consent.kind === 'voided') return 'consent-voided';
  if (Date.parse(f.consent.expiresAt) <= Date.parse(f.now)) return 'consent-expired';
  // why: CodeRabbit (PR #15), pa-b1-006: one rule for the check and the start: pages are served only on a captured
  // rejection, so a never-shown record is refused as itself, never as a missing one
  if (f.consent.kind === 'not-shown') return 'consent-not-shown';
  if (f.counts === 'missing') return 'counts-missing';
  if (f.counts === 'unreadable') return 'counts-unreadable';
  return null;
}

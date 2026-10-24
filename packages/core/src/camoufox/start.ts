/**
 * The camoufox worker's start (decision 76): why it may refuse, the refusal file, the words for each refusal, and the
 * pure start checks. WP17's worker decides its start with `startChecks`; WP16b's status, WP17's start and update and
 * WP18's status report read the same reasons and words, so no two of them can disagree.
 */
import { z } from 'zod';
import { type IsoDateTime, isoDateTimeSchema } from '../types/ids.js';
import { CAMOUFOX_BUILDS, flagsFor, type OsArch } from './builds.js';

/** Why the worker refused to start, written to `<workerData>/start-refusal.json` with the instant. */
export const START_REFUSAL_REASONS = [
  'flags-unset',
  'consent-missing',
  'consent-expired',
  'consent-voided',
  'build-mismatch',
  'layout',
  'signed-in',
  'locked',
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
 * all read it. A fix is a `pnpm gmt …` command, or null where nothing the operator runs fixes it (a build or its flags
 * awaiting verification, which WP18 shows as off).
 */
export const START_REFUSAL_TEXT: Readonly<
  Record<StartRefusalReason, { summary: string; fixCommand: `pnpm gmt ${string}` | null }>
> = {
  'flags-unset': { summary: 'this machine has no verified browser build yet', fixCommand: null },
  'consent-missing': { summary: 'no consent record: capture one', fixCommand: 'pnpm gmt consent' },
  'consent-expired': {
    summary: 'the consent record has expired: capture again',
    fixCommand: 'pnpm gmt consent',
  },
  'consent-voided': { summary: 'consent screen now shown: capture again', fixCommand: 'pnpm gmt consent' },
  'build-mismatch': { summary: 'the installed browser build is not the pinned one', fixCommand: null },
  layout: {
    summary: 'the browser install is incomplete or has changed',
    fixCommand: 'pnpm gmt setup --reconfigure browser',
  },
  'signed-in': {
    summary: 'the browser profile is signed in to an account: capture in a new profile',
    fixCommand: 'pnpm gmt consent',
  },
  locked: { summary: 'another worker holds the lock', fixCommand: 'pnpm gmt restart' },
};

/**
 * The worker's consent record as the start reads it (review R31): a voided record has no expiry, so the type gives it
 * none; a captured (`socs`) or never-shown (`not-shown`) record has its own `expiresAt`.
 */
export type StartConsent = { kind: 'voided' } | { kind: 'socs' | 'not-shown'; expiresAt: IsoDateTime };

/** What the worker's start knows about its machine, its install, its consent record, its profile and its lock. */
export interface StartFacts {
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
 * one (the consent screen is shown again); an expired one (its own `expiresAt`, at or before now). Pure.
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
  return null;
}

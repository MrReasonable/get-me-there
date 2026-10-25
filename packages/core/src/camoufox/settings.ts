/**
 * Spec §12 "Where settings live": the settings the app and the camoufox worker must hold equal, their one rule set
 * (bounds, defaults, messages) and the comparison. The app's config, the worker's `loadWorkerConfig` and WP16b's CLI
 * read these names only through `readSharedSettings`, so no two of them can disagree about a value (review R27).
 */
import { z } from 'zod';

/**
 * The shared names, compared by their effective values (the default applied, integers as decimal strings).
 * CAMOUFOX_BROWSER_WINDOW is not one: the engine decides it.
 */
export const SHARED_WORKER_SETTINGS = [
  'CAMOUFOX_COOLDOWN_HOURS',
  'CAMOUFOX_PAGE_TIMEOUT_SECONDS',
  'CAMOUFOX_MODE',
  'CAMOUFOX_GRID_SCROLL_CAP',
  'CAMOUFOX_GRID_SCROLL_SPACING_SECONDS',
  'CAMOUFOX_MONTHLY_PAGE_CAP',
  'CAMOUFOX_MONTHLY_SCROLL_CAP',
  'CAMOUFOX_BILLING_DAY',
  'POINT_OF_SALE',
] as const;
export type SharedWorkerSetting = (typeof SHARED_WORKER_SETTINGS)[number];
/** Compared only in grid mode: a list worker never scrolls. */
export const GRID_ONLY_SETTINGS = [
  'CAMOUFOX_GRID_SCROLL_CAP',
  'CAMOUFOX_GRID_SCROLL_SPACING_SECONDS',
] as const;
export type SharedSettings = Readonly<Record<SharedWorkerSetting, string>>;

/** The wire shape of a shared-settings record (the worker's `/v1/status` reports one). */
export const sharedSettingsSchema = z.record(z.enum(SHARED_WORKER_SETTINGS), z.string());

/** The defaults (spec §12's block), which both sides apply to a line they lack. */
export const SHARED_WORKER_DEFAULTS: SharedSettings = {
  CAMOUFOX_COOLDOWN_HOURS: '48',
  CAMOUFOX_PAGE_TIMEOUT_SECONDS: '90',
  CAMOUFOX_MODE: 'list',
  CAMOUFOX_GRID_SCROLL_CAP: '30',
  CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: '5',
  CAMOUFOX_MONTHLY_PAGE_CAP: '1500',
  CAMOUFOX_MONTHLY_SCROLL_CAP: '6000',
  CAMOUFOX_BILLING_DAY: '1',
  POINT_OF_SALE: 'GB',
};

type Rule = { min: number; max: number } | { pattern: RegExp; message: string };

/**
 * Each setting's one rule (spec §12): a whole-number range, or a closed pattern with its words. why: the cool-down is
 * bounded at 100,000 hours (about eleven years), the worker's own bound, so an absurd value is refused on both sides.
 */
const SHARED_RULES: Readonly<Record<SharedWorkerSetting, Rule>> = {
  CAMOUFOX_COOLDOWN_HOURS: { min: 24, max: 100_000 },
  CAMOUFOX_PAGE_TIMEOUT_SECONDS: { min: 30, max: 240 },
  CAMOUFOX_MODE: { pattern: /^(list|grid)$/, message: 'must be list or grid' },
  CAMOUFOX_GRID_SCROLL_CAP: { min: 0, max: 60 },
  CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: { min: 0, max: 30 },
  CAMOUFOX_MONTHLY_PAGE_CAP: { min: 0, max: Number.MAX_SAFE_INTEGER },
  CAMOUFOX_MONTHLY_SCROLL_CAP: { min: 0, max: Number.MAX_SAFE_INTEGER },
  CAMOUFOX_BILLING_DAY: { min: 1, max: 28 },
  POINT_OF_SALE: { pattern: /^[A-Z]{2}$/, message: 'must be an ISO 3166-1 alpha-2 code' },
};

/** What a refusal of `name` says: its rule, never the value given. */
export function sharedSettingMessage(name: SharedWorkerSetting): string {
  const rule = SHARED_RULES[name];
  if ('pattern' in rule) return `${name} ${rule.message}`;
  return rule.max === Number.MAX_SAFE_INTEGER
    ? `${name} must be a whole number of at least ${rule.min}`
    : `${name} must be a whole number from ${rule.min} to ${rule.max}`;
}

/** An invalid shared setting: names the settings, never their values. */
export class SharedSettingsError extends RangeError {
  constructor(readonly settings: readonly SharedWorkerSetting[]) {
    super(`invalid shared camoufox settings: ${settings.join(', ')}`);
    this.name = 'SharedSettingsError';
  }
}

/**
 * Spec §12: one side's shared settings from its environment (the app's env, the worker's worker.env, or what the CLI
 * reads from either): the default for an absent or empty line, an integer as its decimal form (`030` is `30`), every
 * name present; a name whose value breaks its rule is listed in `invalid` and holds its default in `settings`, so a
 * reader can report every bad name at once and still build the rest.
 */
export function readSharedSettings(raw: Readonly<Record<string, string | undefined>>): {
  settings: SharedSettings;
  invalid: readonly SharedWorkerSetting[];
} {
  const invalid: SharedWorkerSetting[] = [];
  const out: Record<string, string> = {};
  for (const name of SHARED_WORKER_SETTINGS) {
    const given = raw[name];
    const value = given === undefined || given === '' ? SHARED_WORKER_DEFAULTS[name] : given;
    const rule = SHARED_RULES[name];
    const n = Number(value);
    const ok =
      'pattern' in rule ? rule.pattern.test(value) : /^\d+$/.test(value) && n >= rule.min && n <= rule.max;
    if (!ok) invalid.push(name);
    out[name] = !ok ? SHARED_WORKER_DEFAULTS[name] : 'pattern' in rule ? value : String(n);
  }
  return { settings: sharedSettingsSchema.parse(out), invalid };
}

/** `readSharedSettings` answering the effective record, or only the names of the invalid ones (never the values). */
export function parseSharedSettings(
  raw: Readonly<Record<string, string | undefined>>,
): { ok: true; settings: SharedSettings } | { ok: false; invalid: readonly SharedWorkerSetting[] } {
  const r = readSharedSettings(raw);
  return r.invalid.length > 0 ? { ok: false, invalid: r.invalid } : { ok: true, settings: r.settings };
}

/** `parseSharedSettings` that throws SharedSettingsError naming the invalid settings. */
export function effectiveSharedSettings(raw: Readonly<Record<string, string | undefined>>): SharedSettings {
  const r = parseSharedSettings(raw);
  if (!r.ok) throw new SharedSettingsError(r.invalid);
  return r.settings;
}

/** A shared integer setting as the number its record holds (the record holds only valid decimal forms). */
export function sharedInt(
  s: SharedSettings,
  name: Exclude<SharedWorkerSetting, 'CAMOUFOX_MODE' | 'POINT_OF_SALE'>,
): number {
  return Number(s[name]);
}

/** CAMOUFOX_MODE as its two values. */
export const sharedMode = (s: SharedSettings): 'list' | 'grid' =>
  s.CAMOUFOX_MODE === 'grid' ? 'grid' : 'list';

/**
 * Spec §12: the shared settings on which the app's and the worker's effective records differ, by name only (a value
 * never leaves this function), in SHARED_WORKER_SETTINGS order. The grid-only two are compared only in grid mode. The
 * provider's preflight, the Status view's worker check, the CLI's writer and `gmt status` all read this one rule.
 */
export function sharedSettingDiffs(
  app: SharedSettings,
  worker: SharedSettings,
  mode: 'list' | 'grid',
): readonly SharedWorkerSetting[] {
  const gridOnly: readonly string[] = GRID_ONLY_SETTINGS;
  return SHARED_WORKER_SETTINGS.filter(
    (n) => (mode === 'grid' || !gridOnly.includes(n)) && app[n] !== worker[n],
  );
}

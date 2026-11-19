import { z } from 'zod';
import { type OwnedName, ownedNameSchema, SETTINGS_NAMES } from '../config/settings.js';
import { isoDateTimeSchema } from '../types/ids.js';
import { providerIdSchema } from '../types/provenance.js';

/**
 * The Settings page's routes (UX redesign stage 3, settings plan rulings 5, 6 and 11): what the page reads, what it
 * saves and the test email it sends. No secret ever comes back: a secret setting is `{ set, last4 }`, and `last4` is
 * given only for the two API keys, never a password.
 */

type SettingEntry = (typeof SETTINGS_NAMES)[number];
export type SecretSettingName = Extract<SettingEntry, { secret: true }>['name'];
export type PlainSettingName = Extract<SettingEntry, { secret: false }>['name'];
/** The owned names that are secrets, and those that are not, in SETTINGS_NAMES order. */
export const SECRET_SETTING_NAMES: readonly SecretSettingName[] = SETTINGS_NAMES.filter(
  (s): s is Extract<SettingEntry, { secret: true }> => s.secret,
).map((s) => s.name);
export const PLAIN_SETTING_NAMES: readonly PlainSettingName[] = SETTINGS_NAMES.filter(
  (s): s is Extract<SettingEntry, { secret: false }> => !s.secret,
).map((s) => s.name);

const secretNameSchema = z.enum(SECRET_SETTING_NAMES);
const plainNameSchema = z.enum(PLAIN_SETTING_NAMES);

/** A secret as the page sees it: whether it is set, and the last four characters of an API key. */
export const secretViewSchema = z.strictObject({ set: z.boolean(), last4: z.string().nullable() });

/** The runs a saved setting waits for (their searches' names), while the restart in place waits. */
export const settingsPendingSchema = z.strictObject({ running: z.array(z.string()) });

/** `GET /api/settings` (ruling 5, 6, 8): the stored values, each `null` when unset, and what this boot did with them. */
export const settingsViewSchema = z.strictObject({
  values: z.record(plainNameSchema, z.string().nullable()),
  secrets: z.record(secretNameSchema, secretViewSchema),
  /** Ruling 8, controller ruling R2: the sources a new search starts with, an unset list as the draft gives it. */
  newSearchSources: z.strictObject({
    discovery: z.array(providerIdSchema),
    verification: z.array(providerIdSchema),
  }),
  /** Variables the page shows but does not own. */
  envOnly: z.strictObject({ camoufoxEnabled: z.boolean(), searchApiTrialUsed: z.number().int().min(0) }),
  envIgnored: z.array(ownedNameSchema),
  setAside: z.array(ownedNameSchema),
  pending: settingsPendingSchema.nullable(),
});

/** `PUT /api/settings` (ruling 5): the names the operator changed; `null` unsets one; a secret not named is kept. */
export const settingsUpdateRequestSchema = z.strictObject({
  changes: z.partialRecord(ownedNameSchema, z.string().nullable()),
});

/**
 * A save's answer: boot-style warnings, and whether the new settings apply now (the app restarts at once), after the
 * runs in flight, or `unchanged`: the save changed nothing, so nothing was written and nothing restarts.
 */
export const settingsUpdateResponseSchema = z.discriminatedUnion('applies', [
  z.strictObject({ warnings: z.array(z.string()), applies: z.literal('now') }),
  z.strictObject({ warnings: z.array(z.string()), applies: z.literal('unchanged') }),
  z.strictObject({
    warnings: z.array(z.string()),
    applies: z.literal('after-runs'),
    running: z.array(z.string()),
  }),
]);

/**
 * One refused setting in a 422's `error.details.fields` (ruling 5), in the envelope's own shape: `field` is the owned
 * name and `message` the words to show beside it (core settingRefusal); the page takes the label from SETTING_LABELS.
 */
export const settingRefusalSchema = z.strictObject({ field: ownedNameSchema, message: z.string() });
export const settingsRefusalDetailsSchema = z.strictObject({ fields: z.array(settingRefusalSchema) });

/**
 * `POST /api/settings/email-test` (ruling 11): the email form's values. `pass` may be left out only when host, port, TLS
 * and user equal the stored ones, and the stored password is then used.
 */
export const settingsEmailTestRequestSchema = z.strictObject({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  tls: z.enum(['implicit', 'starttls', 'none']),
  user: z.string().min(1),
  pass: z.string().min(1).optional(),
  from: z.string(),
  to: z.string(),
});
export const settingsEmailTestResponseSchema = z.strictObject({
  result: z.literal('sent'),
  at: isoDateTimeSchema,
});
/** Why a test email failed (a 502's `error.details.reason`): one of four fixed reasons, never the server's reply. */
export const emailTestFailureSchema = z.enum([
  'refused',
  'timed-out',
  'sign-in-refused',
  'not-a-mail-server',
]);

export type SettingsView = z.infer<typeof settingsViewSchema>;
export type SettingsUpdateRequest = z.infer<typeof settingsUpdateRequestSchema>;
export type SettingsUpdateResponse = z.infer<typeof settingsUpdateResponseSchema>;
export type SettingRefusal = z.infer<typeof settingRefusalSchema>;
export type SettingsEmailTestRequest = z.infer<typeof settingsEmailTestRequestSchema>;
export type EmailTestFailure = z.infer<typeof emailTestFailureSchema>;
/** Every owned name a change may carry, typed for the page's forms. */
export type SettingChanges = Partial<Record<OwnedName, string | null>>;

// The Settings page's contract (settings plan rulings 5, 6, 11): a secret is only ever `{ set, last4 }`, a save names
// only owned settings, and the three routes are declared with their own schemas.
import { describe, expect, it } from 'vitest';
import {
  healthDetailSchema,
  PLAIN_SETTING_NAMES,
  ROUTES,
  SECRET_SETTING_NAMES,
  settingRefusalSchema,
  settingsEmailTestRequestSchema,
  settingsUpdateRequestSchema,
  settingsUpdateResponseSchema,
  settingsViewSchema,
} from '../../src/api-contract/index.js';
import { OWNED_NAMES, SETTINGS_NAMES } from '../../src/config/settings.js';

const view = () => ({
  values: Object.fromEntries(PLAIN_SETTING_NAMES.map((n) => [n, null])),
  secrets: Object.fromEntries(SECRET_SETTING_NAMES.map((n) => [n, { set: false, last4: null }])),
  newSearchSources: { discovery: ['travelpayouts'], verification: [] },
  envOnly: { camoufoxEnabled: false, searchApiTrialUsed: 0 },
  envIgnored: [],
  setAside: [],
  pending: null,
});

describe('the settings contract', () => {
  it('splits the owned names into secrets and plain values, in SETTINGS_NAMES order', () => {
    expect(SECRET_SETTING_NAMES).toEqual(['TRAVELPAYOUTS_TOKEN', 'SEARCHAPI_KEY', 'SMTP_PASS']);
    expect([...SECRET_SETTING_NAMES, ...PLAIN_SETTING_NAMES].sort()).toEqual([...OWNED_NAMES].sort());
    expect(PLAIN_SETTING_NAMES).toEqual(SETTINGS_NAMES.filter((s) => !s.secret).map((s) => s.name));
  });

  it('a view carries every name, and a secret only as set and last four: never a value', () => {
    expect(settingsViewSchema.safeParse(view()).success).toBe(true);
    const v = view();
    const leak = { ...v, secrets: { ...v.secrets, SMTP_PASS: { set: true, last4: null, value: 'x' } } };
    expect(settingsViewSchema.safeParse(leak).success).toBe(false);
    expect(settingsViewSchema.safeParse({ ...v, values: { ...v.values, SMTP_PASS: 'x' } }).success).toBe(
      false,
    );
    const { SMTP_HOST: _host, ...missing } = v.values;
    expect(settingsViewSchema.safeParse({ ...v, values: missing }).success).toBe(false);
    expect(settingsViewSchema.safeParse({ ...view(), pending: { running: ['Autumn trip'] } }).success).toBe(
      true,
    );
  });

  it('a save names owned settings only, each a string or null', () => {
    expect(settingsUpdateRequestSchema.safeParse({ changes: {} }).success).toBe(true);
    expect(
      settingsUpdateRequestSchema.safeParse({ changes: { SMTP_PASS: null, FLIGHT_READ_PATIENCE: '20' } })
        .success,
    ).toBe(true);
    expect(settingsUpdateRequestSchema.safeParse({ changes: { PORT: '80' } }).success).toBe(false);
    expect(settingsUpdateRequestSchema.safeParse({ changes: { SMTP_PORT: 465 } }).success).toBe(false);
    expect(settingsUpdateRequestSchema.safeParse({ changes: {}, extra: 1 }).success).toBe(false);
  });

  it("a save's answer applies now, or after the runs it names", () => {
    expect(settingsUpdateResponseSchema.safeParse({ warnings: [], applies: 'now' }).success).toBe(true);
    expect(
      settingsUpdateResponseSchema.safeParse({ warnings: ['w'], applies: 'after-runs', running: ['A'] })
        .success,
    ).toBe(true);
    expect(settingsUpdateResponseSchema.safeParse({ warnings: [], applies: 'after-runs' }).success).toBe(
      false,
    );
  });

  it('a refusal names an owned setting, with its label and words beside the envelope field and message', () => {
    const words = 'Choose a whole number of reads from 3 to 50.';
    const one = {
      field: 'FLIGHT_READ_PATIENCE',
      message: words,
      name: 'FLIGHT_READ_PATIENCE',
      label: 'L',
      words,
    };
    expect(settingRefusalSchema.safeParse(one).success).toBe(true);
    expect(settingRefusalSchema.safeParse({ ...one, name: 'PORT' }).success).toBe(false);
  });

  it('the email test takes the form, with the password optional and the port a port', () => {
    const form = {
      host: 'smtp.example.com',
      port: 465,
      tls: 'implicit',
      user: 'alerts@example.com',
      from: 'alerts@example.com',
      to: 'operator@example.com',
    };
    expect(settingsEmailTestRequestSchema.safeParse(form).success).toBe(true);
    expect(settingsEmailTestRequestSchema.safeParse({ ...form, pass: 'p' }).success).toBe(true);
    expect(settingsEmailTestRequestSchema.safeParse({ ...form, pass: '' }).success).toBe(false);
    expect(settingsEmailTestRequestSchema.safeParse({ ...form, port: 0 }).success).toBe(false);
    expect(settingsEmailTestRequestSchema.safeParse({ ...form, tls: 'ssl' }).success).toBe(false);
  });

  it('declares the three routes with their own schemas, and health detail carries the boot id', () => {
    const keyed = new Map(ROUTES.map((r) => [`${r.method} ${r.path}`, r]));
    expect(keyed.get('GET /api/settings')?.response).toBe(settingsViewSchema);
    expect(keyed.get('PUT /api/settings')?.request).toBe(settingsUpdateRequestSchema);
    expect(keyed.get('POST /api/settings/email-test')?.request).toBe(settingsEmailTestRequestSchema);
    expect(healthDetailSchema.shape.bootId.safeParse('b').success).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config/schema.js';

const realpath = (p: string) => p;
const minimal = {
  NODE_ENV: 'production',
  DATABASE_PATH: '/data/get-me-there.db',
  APP_BASIC_AUTH_USER: 'ian',
  APP_BASIC_AUTH_PASS: 'correct-horse-battery',
  IN_CONTAINER: '1',
};
const parse = (value: string | undefined) =>
  parseConfig({ ...minimal, CAMOUFOX_BROWSER_WINDOW: value }, { realpath });

describe('CAMOUFOX_BROWSER_WINDOW (spec §12, decision 83)', () => {
  it.each([
    ['scheduled', 'scheduled'],
    ['any', 'any'],
    [undefined, 'scheduled'],
    ['', 'scheduled'],
  ] as const)('%s reads as %s (unset and empty mean the default, scheduled)', (value, expected) => {
    const r = parse(value);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.config.camoufoxBrowserWindow).toBe(expected);
  });
  it.each(['Any', 'always', ' scheduled', 'scheduled ', 'SCHEDULED', 'none'])(
    'refuses %j naming the field, with or without the provider enabled',
    (value) => {
      const r = parse(value);
      if (r.ok) throw new Error('expected a refusal');
      expect(r.errors.map((e) => e.field)).toEqual(['CAMOUFOX_BROWSER_WINDOW']);
    },
  );
});

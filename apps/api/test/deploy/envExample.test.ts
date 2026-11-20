// Spec §12: .env.example is the spec's block verbatim, and it names every variable the config reads.
import { SETTINGS_NAMES } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { ALL_VARS } from '../helpers/env.js';
import { envExampleVariables, read, specEnvBlock } from './files.js';

/**
 * Variables the config reads that .env.example must not offer: IN_CONTAINER is set by the Dockerfile and
 * PUBLISHED_ADDRESS by docker-compose.yml (both appear only commented), and FIXTURE_COST_MICRO_GBP exists for engine
 * tests under the synthetic gate (plan "Config"). CAMOUFOX_MODE is offered since grid mode (decision 70).
 */
const NOT_OPERATOR = ['IN_CONTAINER', 'PUBLISHED_ADDRESS', 'FIXTURE_COST_MICRO_GBP'];

describe('.env.example (spec §12)', () => {
  it('is the spec §12 block verbatim', () => {
    expect(read('.env.example')).toBe(`${specEnvBlock()}\n`);
  });

  it('defines exactly the variables the config reads, overrides expanded (WP4b ALL_VARS)', () => {
    const expected = ALL_VARS.filter((n) => !NOT_OPERATOR.includes(n)).sort();
    expect(envExampleVariables(read('.env.example'))).toEqual(expected);
    expect(expected).toEqual(
      expect.arrayContaining(['ALERT_EMAIL_MAX_PER_HOUR', 'APP_BASE_URL', 'TRUST_PROXY']),
    );
  });

  it('offers CAMOUFOX_BROWSER_WINDOW with its two values and its default (decision 83)', () => {
    const line = read('.env.example')
      .split('\n')
      .find((l) => l.startsWith('CAMOUFOX_BROWSER_WINDOW='));
    expect(line).toMatch(/^CAMOUFOX_BROWSER_WINDOW=scheduled +# exactly scheduled \(default when unset/);
    expect(line).toContain(' or any (');
  });

  it('carries no value for any credential', () => {
    for (const name of ['APP_BASIC_AUTH_PASS', 'TRAVELPAYOUTS_TOKEN', 'SEARCHAPI_KEY', 'SMTP_PASS'])
      expect(read('.env.example')).toMatch(new RegExp(`^${name}=( |$)`, 'm'));
  });

  // why: settings plan rulings 1 and 2: the Settings page owns these names from the app's first start; a line for one is
  // imported once, then reported and never applied, so the file says which they are
  it('marks exactly the names the Settings page owns, and says a line for one is imported once', () => {
    const text = read('.env.example');
    const marked = text
      .split('\n')
      .filter((l) => !l.startsWith('#') && l.includes('[Settings]'))
      .map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l)?.[1] ?? `not a variable line: ${l}`);
    expect(marked.sort()).toEqual(SETTINGS_NAMES.map((s) => s.name).sort());
    expect(text.replace(/\n# /g, ' ')).toContain(
      'Names marked [Settings] are the Settings page’s from the app’s first start: a line for one is imported once, when the app holds no value for it, then reported and never applied (docs/setup.md section 0).',
    );
  });

  it('says a trial count on the $40 plan is ignored with a warning (settings plan ruling 1)', () => {
    const line = read('.env.example')
      .split('\n')
      .find((l) => l.startsWith('SEARCHAPI_TRIAL_USED='));
    expect(line).toContain('above 0 on 40usd is ignored, with a warning');
    expect(line).not.toContain('fails boot');
  });
});

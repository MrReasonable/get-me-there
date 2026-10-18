// Spec §12: .env.example is the spec's block verbatim, and it names every variable the config reads.
import { describe, expect, it } from 'vitest';
import { ALL_VARS } from '../helpers/env.js';
import { envExampleVariables, read, specEnvBlock } from './files.js';

/**
 * Variables the config reads that .env.example must not offer: IN_CONTAINER is set by the Dockerfile (it appears
 * only commented) and FIXTURE_COST_MICRO_GBP exists for engine tests under the synthetic gate (plan "Config").
 * CAMOUFOX_MODE is offered since grid mode (decision 70).
 */
const NOT_OPERATOR = ['IN_CONTAINER', 'FIXTURE_COST_MICRO_GBP'];

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

  it('carries no value for any credential', () => {
    for (const name of ['APP_BASIC_AUTH_PASS', 'TRAVELPAYOUTS_TOKEN', 'SEARCHAPI_KEY', 'SMTP_PASS'])
      expect(read('.env.example')).toMatch(new RegExp(`^${name}=( |$)`, 'm'));
  });
});

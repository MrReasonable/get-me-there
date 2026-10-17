import { parseConfig } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { createHarness } from './support/harness.js';

describe('buildContext: the engine-level synthetic gate (spec §5.5; prov-wp07-012)', () => {
  it('a production config with the fixture provider registered is refused at construction, before any request or write', () => {
    const h = createHarness();
    const parsed = parseConfig(
      {
        NODE_ENV: 'production',
        DATABASE_PATH: '/data/app.db',
        BIND_ADDRESS: '127.0.0.1',
        MONTHLY_SPEND_CAP_PENCE: '100000',
        EXECUTION_MAX_CALLS: '1000',
        EXECUTION_MAX_COST_PENCE: '100000',
        FIXTURE_COST_MICRO_GBP: '3200',
      },
      { realpath: (p) => p },
    );
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    // why: the production gate is closed (no ALLOW_FIXTURE_PROVIDER), yet the deps still register the fixture provider
    const deps = { ...h.deps, config: parsed.config };
    const message = 'the fixture provider is registered but syntheticAllowed(config) is false (spec §5.5)';
    expect(() => buildContext(deps, h.options)).toThrow(message);
    expect(h.requests).toEqual([]);
    expect(h.count('provider_requests')).toBe(0);
    expect(h.count('calendar_prices')).toBe(0);
    expect(h.repos.executions.listByStatus(['pending', 'running'])).toEqual([]);
  });
});

describe('ProviderRunLimits.capKind (code-architect review 8)', () => {
  it('names the cap a provider counts against, derived once: provider-month, or provider-lifetime for a lifetime plan', () => {
    // why: the limits come from budgetConfigFromConfig(config); SearchApi's plan sets its window (the trial is lifetime)
    const kindFor = (plan: string) => {
      const h = createHarness({ env: { SEARCHAPI_KEY: 'layer-a-placeholder', SEARCHAPI_PLAN: plan } });
      return buildContext(h.deps, h.options).limitsOf('searchapi').capKind;
    };
    expect(kindFor('40usd')).toBe('provider-month');
    expect(kindFor('trial')).toBe('provider-lifetime');
  });
});

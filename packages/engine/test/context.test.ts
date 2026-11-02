import { parseConfig } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { engineWith, stubCamoufox } from './support/camoufox.js';
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

// Spec rev 56 §8.1, §8.2 (arch-r3-006; ruling P19): the flights request's own seconds, from core's one computation over
// the shared page timeout and spacing, for camoufox only; and the worker's last reported flags, kept in memory.
describe('ProviderRunLimits.flightRequestSeconds and EngineContext.workerFlags (spec rev 56 §8.1)', () => {
  it("limitsOf('camoufox') carries 780 / 600 s (and an outbound-only request's 210 s) at the defaults; another provider null", () => {
    const e = engineWith([stubCamoufox({ cells: 1 })]);
    expect(e.ctx.limitsOf('camoufox').flightRequestSeconds).toEqual({
      booking: 780,
      returnsOnly: 600,
      outboundOnly: 210,
    });
    const slow = engineWith([stubCamoufox({ cells: 1 })], {
      env: { CAMOUFOX_PAGE_TIMEOUT_SECONDS: '120', CAMOUFOX_MIN_SPACING_SECONDS: '45' },
    });
    expect(slow.ctx.limitsOf('camoufox').flightRequestSeconds).toEqual({
      booking: 1035,
      returnsOnly: 795,
      outboundOnly: 270,
    });
    const h = createHarness();
    expect(buildContext(h.deps, h.options).limitsOf('fixture').flightRequestSeconds).toBeNull();
  });

  it('workerFlags: null before any read, the last set afterwards, per provider, shared by every copy of the context', () => {
    const h = createHarness();
    const ctx = buildContext(h.deps, h.options);
    expect(ctx.workerFlags.get('camoufox')).toBeNull();
    ctx.workerFlags.set('camoufox', { RETURN_SELECT_VERIFIED: true });
    const copy = { ...ctx };
    copy.workerFlags.set('camoufox', { RETURN_SELECT_VERIFIED: false, BOOKING_SELECT_VERIFIED: false });
    expect(ctx.workerFlags.get('camoufox')).toEqual({
      RETURN_SELECT_VERIFIED: false,
      BOOKING_SELECT_VERIFIED: false,
    });
    expect(ctx.workerFlags.get('fixture')).toBeNull();
  });
});

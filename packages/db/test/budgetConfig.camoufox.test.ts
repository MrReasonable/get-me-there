import { fixedClock } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { budgetConfigFromConfig } from '../src/budgetConfig.js';
import { SqliteBudgetGuard } from '../src/budgetGuard.js';
import { freshDb, T0 } from './helpers/db.js';
import { camoufoxEnv, configFrom } from './helpers/guard.js';

beforeEach(() => {
  expect.hasAssertions();
});

describe('budgetConfigFromConfig: camoufox (cost-005)', () => {
  it('has a never-billable entry with the execution cap and pages-only counting', () => {
    expect(budgetConfigFromConfig(configFrom(camoufoxEnv())).providers.camoufox).toMatchObject({
      billable: false,
      trialUsed: 0,
      executionCallCap: 100,
      pagesOnly: true,
      monthlyCallCap: 1500,
      costPerCallMicroGbp: 0,
    });
  });
  it('a reserve through that config succeeds and counts under provider-month', () => {
    const g = new SqliteBudgetGuard(
      freshDb(),
      budgetConfigFromConfig(configFrom(camoufoxEnv())),
      fixedClock(T0),
    );
    g.reserve({
      providerId: 'camoufox',
      executionId: null,
      tileIndex: null,
      costMicroGbp: 0,
      httpAttempt: 1,
      endpointPath: '/v1/page',
    }).finalise({
      outcome: 'ok',
      httpStatus: 200,
      durationMs: 1,
      pageClass: 'page',
    });
    expect(g.usage({ kind: 'provider-month', providerId: 'camoufox' }).calls).toBe(1);
  });
  it('with camoufox disabled there is no entry and a camoufox reserve fails closed', () => {
    const config = budgetConfigFromConfig(configFrom({ ...camoufoxEnv(), CAMOUFOX_ENABLED: 'false' }));
    expect(config.providers.camoufox).toBeUndefined();
    const g = new SqliteBudgetGuard(freshDb(), config, fixedClock(T0));
    expect(() =>
      g.reserve({
        providerId: 'camoufox',
        executionId: null,
        tileIndex: null,
        costMicroGbp: 0,
        httpAttempt: 1,
        endpointPath: '/v1/page',
      }),
    ).toThrow(/no budget configuration/);
  });
});

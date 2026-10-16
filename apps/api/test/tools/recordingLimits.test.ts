import { searchApiHttpLimits, travelpayoutsHttpLimits } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import { recordingLimits } from '../../src/tools/recordRequests.js';
import { loadConfigFromEnv } from '../../src/wiring.js';
import { testEnv } from '../helpers/env.js';

describe('recordingLimits (plan decision 23: the adapters own their limits)', () => {
  it('records SearchApi and Travelpayouts with the adapters own limits, classifier included', () => {
    const config = loadConfigFromEnv(testEnv());
    const { searchapi: sa, travelpayouts: tp } = config.providers;
    if (sa === null || tp === null) throw new Error('testEnv configures both vendors');
    const t = { maxWaitSeconds: config.maxWaitSeconds, requestTimeoutSeconds: config.requestTimeoutSeconds };
    const limits = recordingLimits(tp, sa, config);
    expect(limits.searchapi).toEqual(searchApiHttpLimits(sa.limits, t));
    expect(limits.searchapi?.classifyError).toBe(searchApiHttpLimits(sa.limits, t).classifyError);
    expect(limits.travelpayouts).toEqual(travelpayoutsHttpLimits(tp.limits, t));
  });
});

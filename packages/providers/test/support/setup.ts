import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { installNetworkGuards } from '../../src/testing/network.js';
import { liveBudgets } from '../fakes.js';

// why: the same guards every package installs (DNS refused, catch-all strays fail the test, abort-settling helpers).
installNetworkGuards({ beforeAll, afterEach, afterAll });

afterEach(() => {
  // why: every reservation is finalised exactly once on every path (spec §5.3); a leak here is a budget bug.
  for (const budget of liveBudgets.splice(0)) expect(budget.open(), 'open reservations').toEqual([]);
});

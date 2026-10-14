import { describe, expect, it } from 'vitest';
import { syntheticAllowed } from '../../src/config/synthetic.js';

// Spec §5.5: the single gate behind which synthetic (fixture) data may exist.
const base = {
  nodeEnv: 'production',
  databasePath: '/data/get-me-there.db',
  allowFixtureProvider: null,
  inContainer: true,
} as const;

describe('syntheticAllowed (spec §5.5)', () => {
  it.each([
    // nodeEnv, databasePath, allowFixtureProvider, inContainer, expected
    ['test', ':memory:', null, false, true],
    ['test', '/tmp/x.test.db', null, false, true],
    ['test', '/tmp/x.test.db', null, true, true], // the container flag does not matter on the test branch
    ['test', '/tmp/x.db', null, false, false], // wrong suffix
    ['test', '/tmp/x.test.db/../prod.db', null, false, false], // the path is realpath-resolved before here; a non-suffix path fails
    ['development', '/tmp/x.fixture.db', 'i-understand-this-is-fake', false, true],
    ['development', '/tmp/x.fixture.db', 'i-understand-this-is-fake', true, false], // inside the container
    ['development', '/tmp/x.fixture.db', 'yes', false, false], // wrong phrase
    ['development', '/tmp/x.db', 'i-understand-this-is-fake', false, false], // wrong suffix
    ['production', '/tmp/x.fixture.db', 'i-understand-this-is-fake', false, false],
    ['production', ':memory:', null, false, false],
    ['production', '/data/get-me-there.db', null, true, false],
  ] as const)(
    '%s %s %s container=%s → %s',
    (nodeEnv, databasePath, allowFixtureProvider, inContainer, expected) => {
      expect(syntheticAllowed({ ...base, nodeEnv, databasePath, allowFixtureProvider, inContainer })).toBe(
        expected,
      );
    },
  );

  it('is false when the path merely contains the suffix elsewhere', () => {
    expect(
      syntheticAllowed({ ...base, nodeEnv: 'test', databasePath: '/tmp/a.test.db.bak', inContainer: false }),
    ).toBe(false);
  });
});

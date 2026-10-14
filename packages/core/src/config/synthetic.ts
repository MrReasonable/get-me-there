/**
 * The single gate behind which synthetic (fixture) data may exist. Spec §5.5.
 *
 * Two branches only:
 *  - tests: NODE_ENV=test with an in-memory DB or a file ending in `.test.db`;
 *  - local development: the exact opt-in phrase, NODE_ENV=development, not inside the
 *    container, and a DB file ending in `.fixture.db`.
 *
 * `databasePath` must already be realpath-resolved by the caller (the api bootstrap does
 * this) so symlinks and `..` cannot smuggle a production file through the suffix check.
 */
export interface SyntheticGateInput {
  nodeEnv: 'production' | 'development' | 'test';
  databasePath: string;
  allowFixtureProvider: string | null;
  inContainer: boolean;
}

/** The exact opt-in phrase for ALLOW_FIXTURE_PROVIDER; anything else is "off". */
export const FIXTURE_OPT_IN_PHRASE = 'i-understand-this-is-fake';

export function syntheticAllowed(c: SyntheticGateInput): boolean {
  if (c.nodeEnv === 'test') {
    return c.databasePath === ':memory:' || c.databasePath.endsWith('.test.db');
  }
  if (c.nodeEnv === 'development') {
    return (
      c.allowFixtureProvider === FIXTURE_OPT_IN_PHRASE &&
      !c.inContainer &&
      c.databasePath.endsWith('.fixture.db')
    );
  }
  // why: production never gets a branch; the gate is closed by construction, not by configuration.
  return false;
}

/** The fixture provider's only host (spec §5.5, §9 item 2: its allowlist is fixture.local only). */
export const FIXTURE_HOST = 'fixture.local';
export const FIXTURE_ORIGIN = `http://${FIXTURE_HOST}`;
/** Scenario control: POST { rules } replaces the rules, DELETE clears them. */
export const SCENARIO_PATH = '/__fixture/scenario';
/** Hold release: POST { id, respond? } settles every request held under id. */
export const RELEASE_PATH = '/__fixture/release';
/** Per-request override header carrying a JSON-encoded FixtureResponse (direct tests only). */
export const SCENARIO_HEADER = 'x-fixture-scenario';

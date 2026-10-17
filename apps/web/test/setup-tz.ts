// Review focus 3. Vitest runs setupFiles in each worker before it imports the test file, so no Date exists yet.
// The test:tz script sets GMT_TEST_TZ; under pool 'forks' each worker is its own Node process, where an assignment to
// process.env.TZ re-detects the zone for Date and Intl.
// why: a separate variable (not TZ itself) makes the zone explicit and immune to a stray shell TZ.
const forced = process.env.GMT_TEST_TZ;
if (forced !== undefined && forced !== '') process.env.TZ = forced;

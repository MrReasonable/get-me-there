// `@gmt/providers/fixture`: the gated fixture router and its scenario-control contract (WP4b wiring, WP7 tests).
export { fixtureRouter } from './router.js'; // WP4b: inProcessHosts['fixture.local']
export { type FixtureResponse, type FixtureRule, releaseRequest, scenarioRequest } from './server.js'; // WP7
export { defaultFixtureRoot } from './tree.js'; // WP4b, WP7

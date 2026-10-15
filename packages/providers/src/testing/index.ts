// `@gmt/providers/testing`: the only module tree that imports msw (plan decision 7). Production code never imports it.
export { withContentHash } from '../http/recorder.js';
export { fixtureHandlers, type RequestHandler } from './handlers.js';
export {
  type GuardHooks,
  guardedServer,
  hangUntilAborted,
  installNetworkGuards,
  respondAfter,
  takeStrays,
} from './network.js'; // WP4b and every later package's vitest setup file
export { loadRecorded, replayHandlers } from './replay.js';
export { verifyFixturesTree, verifyRecordedFile, verifyRecordedTree } from './verify.js'; // WP4b record tool, tests

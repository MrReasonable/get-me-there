// `@gmt/providers/testing`: the only module tree that imports msw (plan decision 7). Production code never imports it.
// why: review R30 — the production limiter, for the engine's interleaved-pages test only; on this subpath, which
// production code may not import, so no second limiter for a provider can be built outside http-kit
export { createLimiter, type ProviderLimiter } from '../http/limiter.js';
export { withContentHash } from '../http/recorder.js';
export { loadParamsHistory } from '../params/allowlist.js'; // replay's dated allowlist history (spec §5.2)
export { fixtureHandlers, type RequestHandler } from './handlers.js';
export {
  type GuardHooks,
  guardedServer,
  hangUntilAborted,
  installNetworkGuards,
  respondAfter,
  takeStrays,
} from './network.js'; // WP4b and every later package's vitest setup file
export { recordingsPresent, recordingsPresentForKind, SKIP_SUFFIX, skipTitle } from './recordings.js'; // decisions 61, 64: the one visible-skip guard
export { loadRecorded, replayHandlers } from './replay.js';
export { verifyFixturesTree, verifyRecordedFile, verifyRecordedTree } from './verify.js'; // WP4b record tool, tests

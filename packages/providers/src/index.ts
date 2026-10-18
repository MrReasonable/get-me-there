// Barrel for @gmt/providers (spec §4: imports @gmt/core only; no SQLite, reads no environment variables). The plan contract plus the
// named-consumer extras; the fixture router lives in ./fixture and msw-based helpers in ./testing (plan decision 7).

export {
  BLOCKED_WORDS,
  CAMOUFOX_DISCOVERY_INFO,
  CAMOUFOX_DISPLAY_NAME,
  CAMOUFOX_GRID_INFO,
  camoufoxHttpLimits,
  camoufoxProvider,
  camoufoxStatusHttpLimits,
  classifyWorkerAnswer,
  coolingDownWords,
  gridTileEstimate,
  planGridTiles,
  planSingleCells,
} from './camoufox/index.js'; // WP14: apps/api httpLimitsFor and providersFor; the smoke rows; classifyWorkerAnswer: engine tests
export { fixtureHttpLimits, fixtureProvider } from './fixture/provider.js'; // fixtureHttpLimits: WP4b httpLimitsFor
export { CREDENTIAL_HEADERS, canonicalCacheKey } from './http/cacheKey.js'; // CREDENTIAL_HEADERS: WP4b createLogger
export { createHttpKit } from './http/httpKit.js';
export {
  assertRecordedRoot,
  canonicalJson,
  contentHash,
  createRecorder,
  defaultRecordedRoot,
  type RecordedFixture,
  RecorderRefusedError,
  withContentHash,
} from './http/recorder.js'; // canonicalJson: WP5/WP6; RecorderRefusedError, defaultRecordedRoot, withContentHash, assertRecordedRoot: WP4b
export { scrubSecrets, stripUrl } from './http/scrub.js';
export { secretForms } from './http/secretForms.js'; // WP4b: the secret scan and its sentinel test share the scrubber's list
export type {
  FixtureRecorder,
  HttpKit,
  HttpKitDeps,
  HttpKitRequest,
  HttpKitResponse,
  HttpProviderId,
  ProviderHttpLimits,
  ResponseFacts,
} from './http/types.js';
export {
  assertRequestAllowed,
  loadParamsAllowlist,
  type ParamsAllowlist,
  ParamsNotAllowedError,
} from './params/allowlist.js';
export { searchApiHttpLimits } from './searchapi/limits.js'; // WP5: apps/api httpLimitsFor
export { SEARCHAPI_PARAMS } from './searchapi/params.js'; // WP5: apps/api providersFor
export { searchApiProvider } from './searchapi/provider.js'; // WP5: apps/api providersFor
export { travelpayoutsHttpLimits } from './travelpayouts/limits.js'; // WP6: apps/api httpLimitsFor
export { TRAVELPAYOUTS_PARAMS } from './travelpayouts/params.js'; // WP6: apps/api providersFor
export { travelpayoutsProvider } from './travelpayouts/provider.js'; // WP6: apps/api providersFor

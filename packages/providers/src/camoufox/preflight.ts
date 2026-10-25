/**
 * The unledgered preflight (spec §2 "Before planning camoufox tiles, the engine reads the worker's /v1/status";
 * decision 69; cost-015): GET /v1/status under `camoufox-status`, never a ledger row. A cool-down or a standing
 * signed-in refusal skips the provider's cells `provider_disabled` (with the end, which keys the once-per-cool-down
 * notice); a worker that cannot be reached, or answers what this build cannot read, skips them `provider_unavailable`.
 */
import {
  AbortedError,
  APP_INSTANCE_HEADER,
  GRID_STEP_DAYS,
  type PreflightResult,
  type ProviderContext,
  ProviderError,
  type Secret,
  type SharedSettings,
  sharedSettingDiffs,
  WORKER_KEY_HEADER,
  type WorkerStatus,
  workerStatusSchema,
} from '@gmt/core';
import type { HttpKit } from '../http/types.js';

export const UNREACHABLE = 'browser worker not reachable';
/** Fix round 1 (arch M9, prov M1): the distinct details, so a wrong key never reads as an absent worker. */
export const KEY_REFUSED = 'the worker refused CAMOUFOX_WORKER_KEY (the app and worker.env differ)';
export const UNREADABLE = "the worker's status could not be read by this build (versions differ?)";
export const SIGNED_IN_REFUSED = 'signed-in profile refused';
/** W3: the worker refuses every page while its counts file cannot be read; waiting does not repair it. */
export const COUNTS_UNREADABLE =
  "the browser worker's monthly counts file cannot be read, so it refuses every page (pnpm gmt browser counts rewrites it)";
export const GRID_NOT_VERIFIED =
  'grid mode not verified on the worker (CAMOUFOX_MODE=grid in worker.env, and the same measured grid step)';

/** Fix round 1 (CA 9): a grid setting the worker and the app read separately differs. */
export const gridSettingDiffers = (name: string, worker: number | null | undefined, app: number): string =>
  `${name} differs: the worker has ${worker ?? 'none'}, the app ${app} (set the same value in worker.env and the app)`;

/**
 * What one read of the worker's `/v1/status` found (decision 76). A refusal keeps the classifier's own kind (review
 * R33): `auth` (a 401 or a 403, the key refused) is the operator's configuration, any other kind the worker's state;
 * its status is the one the worker answered, or null when the answer had none.
 */
export type WorkerStatusRead =
  | { kind: 'ok'; status: WorkerStatus }
  | { kind: 'unreachable' }
  | { kind: 'refused'; errorKind: ProviderError['kind']; httpStatus: number | null }
  | { kind: 'unreadable' };

/**
 * One read of the worker's `/v1/status` (decision 76), shared by the engine's preflight and the Status view's worker
 * check: GET under `camoufox-status`, which is never ledgered and has its own limiter, so a status read takes no
 * camoufox page token and never touches the worker's pacer. No answer is `unreachable`, an HTTP error answer (a wrong
 * key included) `refused`, a body this build cannot read `unreadable`. The caller's signal bounds it (the status check
 * passes a 2 s one); an abort propagates as AbortedError. `appInstance` is the database's app-instance id (decision 82).
 */
export async function readWorkerStatus(o: {
  http: HttpKit;
  key: Secret;
  url: string;
  signal: AbortSignal;
  appInstance?: string;
}): Promise<WorkerStatusRead> {
  const { http, key, url, signal, appInstance } = o;
  let body: unknown;
  try {
    const res = await http.request({
      providerId: 'camoufox-status',
      executionId: null,
      tileIndex: null,
      endpointPath: '/v1/status',
      method: 'GET',
      url: new URL('/v1/status', url),
      headers: {
        [WORKER_KEY_HEADER]: key.reveal(),
        accept: 'application/json',
        ...(appInstance === undefined ? {} : { [APP_INSTANCE_HEADER]: appInstance }),
      },
      cache: 'never',
      signal,
      recordFixtures: false,
    });
    body = res.body;
  } catch (e) {
    if (e instanceof AbortedError) throw e;
    // why: the classifier read the answer; its kind is kept, and no status is made up for an answer that had none
    if (e instanceof ProviderError && (e.kind === 'auth' || e.httpStatus !== undefined))
      return { kind: 'refused', errorKind: e.kind, httpStatus: e.httpStatus ?? null };
    return { kind: 'unreachable' };
  }
  const s = workerStatusSchema.safeParse(body);
  return s.success ? { kind: 'ok', status: s.data } : { kind: 'unreadable' };
}

/** The preflight's refusal when the worker's effective shared settings differ from the app's (spec §12), names only. */
export const settingsDiffer = (names: readonly string[]): string => `settings differ: ${names.join(', ')}`;

export async function camoufoxPreflight(
  o: {
    http: HttpKit;
    key: Secret;
    workerUrl: string;
    /** The app's effective shared settings (spec §12), compared with the worker's through sharedSettingDiffs. */
    sharedSettings?: SharedSettings;
    /** The database's app-instance id (decision 82), sent as APP_INSTANCE_HEADER. */
    appInstance?: string;
    /** Grid mode, with the app's scroll cap and spacing, which the worker's must equal. */
    grid?: { scrollCap: number; spacingSeconds: number; pageTimeoutSeconds: number };
  },
  ctx: ProviderContext,
): Promise<PreflightResult> {
  const read = await readWorkerStatus({
    http: o.http,
    key: o.key,
    url: o.workerUrl,
    signal: ctx.signal,
    ...(o.appInstance === undefined ? {} : { appInstance: o.appInstance }),
  });
  // why: a refused key (the classifier's auth: 401 or 403) is a configuration fault: provider_disabled, which a resume
  // does not retry on every run
  if (read.kind === 'refused' && read.errorKind === 'auth')
    return { ok: false, skip: 'provider_disabled', detail: KEY_REFUSED };
  if (read.kind === 'refused')
    return {
      ok: false,
      skip: 'provider_unavailable',
      detail:
        read.httpStatus === null
          ? `the browser worker refused the status read (${read.errorKind})`
          : `the browser worker answered HTTP ${read.httpStatus}`,
    };
  if (read.kind === 'unreachable') return { ok: false, skip: 'provider_unavailable', detail: UNREACHABLE };
  if (read.kind === 'unreadable') return { ok: false, skip: 'provider_unavailable', detail: UNREADABLE };
  const st = read.status;
  if (st.coolingDownUntil !== null)
    return {
      ok: false,
      skip: 'provider_disabled',
      detail: `cooling down until ${st.coolingDownUntil} (${st.cooldownCause ?? 'unknown'})`,
      until: st.coolingDownUntil,
    };
  if (st.signedInRefusal || st.accountCookie.found)
    return { ok: false, skip: 'provider_disabled', detail: SIGNED_IN_REFUSED };
  if (st.monthly !== undefined && !st.monthly.readable)
    return { ok: false, skip: 'provider_disabled', detail: COUNTS_UNREADABLE };
  // why: spec §12 — both sides compare effective values, by name; a worker too old to report its record is compared
  // on what it does report (the grid-only comparison below), as before
  const shared = st.sharedSettings;
  if (shared !== undefined && o.sharedSettings !== undefined) {
    const differ = sharedSettingDiffs(o.sharedSettings, shared, o.grid === undefined ? 'list' : 'grid');
    if (differ.length > 0) return { ok: false, skip: 'provider_disabled', detail: settingsDiffer(differ) };
  }
  // why: spec §2 rev 34: grid pages are planned from the measured step, so the worker must report the same one
  const step = st.gridStepDays;
  if (o.grid === undefined) return { ok: true };
  if (
    step === undefined ||
    step === null ||
    step.departures !== GRID_STEP_DAYS.departures ||
    step.returns !== GRID_STEP_DAYS.returns
  )
    return { ok: false, skip: 'provider_disabled', detail: GRID_NOT_VERIFIED };
  // why: fix round 1 (CA 9): a lower worker cap refuses every page (400); a longer worker spacing outlasts the app's
  // request timeout; either is a configuration fault, named
  if (st.gridScrollCap !== o.grid.scrollCap)
    return {
      ok: false,
      skip: 'provider_disabled',
      detail: gridSettingDiffers('CAMOUFOX_GRID_SCROLL_CAP', st.gridScrollCap, o.grid.scrollCap),
    };
  // why: CodeRabbit on PR #9: a longer worker page timeout outlasts the app's request timeout, even with no scroll
  if (st.pageTimeoutSeconds !== o.grid.pageTimeoutSeconds)
    return {
      ok: false,
      skip: 'provider_disabled',
      detail: gridSettingDiffers(
        'CAMOUFOX_PAGE_TIMEOUT_SECONDS',
        st.pageTimeoutSeconds,
        o.grid.pageTimeoutSeconds,
      ),
    };
  if (st.gridScrollSpacingSeconds !== o.grid.spacingSeconds)
    return {
      ok: false,
      skip: 'provider_disabled',
      detail: gridSettingDiffers(
        'CAMOUFOX_GRID_SCROLL_SPACING_SECONDS',
        st.gridScrollSpacingSeconds,
        o.grid.spacingSeconds,
      ),
    };
  return { ok: true };
}

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

/** What a worker's own status says it will do with the next page request (the one list preflight and Status read). */
export type WorkerFinding =
  | {
      kind: 'cooling';
      until: WorkerStatus['coolingDownUntil'] & string;
      cause: WorkerStatus['cooldownCause'];
    }
  | { kind: 'signed-in' }
  /** W3: the worker's monthly counts file cannot be read, so it refuses every page; waiting does not repair it. */
  | { kind: 'counts-unreadable' }
  | { kind: 'settings'; names: readonly string[] }
  | { kind: 'grid-unverified' }
  | { kind: 'grid-setting'; name: string; worker: number | null | undefined; app: number };

/**
 * The first reason a worker that answered will refuse pages (spec §2, §12), in the order the preflight has always judged
 * them: a cool-down, a signed-in profile, a monthly counts file it cannot read (W3), shared settings that differ, then, in grid mode, an unverified grid step or a
 * grid setting that differs. Null when none applies. Pure: the preflight skips cells on it and the Status report words it.
 */
export function workerFinding(
  st: WorkerStatus,
  o: {
    sharedSettings?: SharedSettings | undefined;
    grid?: { scrollCap: number; spacingSeconds: number; pageTimeoutSeconds: number } | undefined;
  },
): WorkerFinding | null {
  if (st.coolingDownUntil !== null)
    return { kind: 'cooling', until: st.coolingDownUntil, cause: st.cooldownCause };
  if (st.signedInRefusal || st.accountCookie.found) return { kind: 'signed-in' };
  if (st.monthly !== undefined && !st.monthly.readable) return { kind: 'counts-unreadable' };
  // why: spec §12 — both sides compare effective values, by name; a worker too old to report its record is compared
  // on what it does report (the grid-only comparison below), as before
  const shared = st.sharedSettings;
  if (shared !== undefined && o.sharedSettings !== undefined) {
    const differ = sharedSettingDiffs(o.sharedSettings, shared, o.grid === undefined ? 'list' : 'grid');
    if (differ.length > 0) return { kind: 'settings', names: differ };
  }
  if (o.grid === undefined) return null;
  // why: spec §2 rev 34: grid pages are planned from the measured step, so the worker must report the same one
  const step = st.gridStepDays;
  if (
    step === undefined ||
    step === null ||
    step.departures !== GRID_STEP_DAYS.departures ||
    step.returns !== GRID_STEP_DAYS.returns
  )
    return { kind: 'grid-unverified' };
  // why: fix round 1 (CA 9): a lower worker cap refuses every page (400); a longer worker spacing outlasts the app's
  // request timeout; either is a configuration fault, named. CodeRabbit on PR #9: a longer worker page timeout
  // outlasts the app's request timeout, even with no scroll
  if (st.gridScrollCap !== o.grid.scrollCap)
    return {
      kind: 'grid-setting',
      name: 'CAMOUFOX_GRID_SCROLL_CAP',
      worker: st.gridScrollCap,
      app: o.grid.scrollCap,
    };
  if (st.pageTimeoutSeconds !== o.grid.pageTimeoutSeconds)
    return {
      kind: 'grid-setting',
      name: 'CAMOUFOX_PAGE_TIMEOUT_SECONDS',
      worker: st.pageTimeoutSeconds,
      app: o.grid.pageTimeoutSeconds,
    };
  if (st.gridScrollSpacingSeconds !== o.grid.spacingSeconds)
    return {
      kind: 'grid-setting',
      name: 'CAMOUFOX_GRID_SCROLL_SPACING_SECONDS',
      worker: st.gridScrollSpacingSeconds,
      app: o.grid.spacingSeconds,
    };
  return null;
}

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
  const found = workerFinding(read.status, o);
  if (found === null) return { ok: true };
  switch (found.kind) {
    case 'cooling':
      return {
        ok: false,
        skip: 'provider_disabled',
        detail: `cooling down until ${found.until} (${found.cause ?? 'unknown'})`,
        until: found.until,
      };
    case 'signed-in':
      return { ok: false, skip: 'provider_disabled', detail: SIGNED_IN_REFUSED };
    case 'counts-unreadable':
      return { ok: false, skip: 'provider_disabled', detail: COUNTS_UNREADABLE };
    case 'settings':
      return { ok: false, skip: 'provider_disabled', detail: settingsDiffer(found.names) };
    case 'grid-unverified':
      return { ok: false, skip: 'provider_disabled', detail: GRID_NOT_VERIFIED };
    case 'grid-setting':
      return {
        ok: false,
        skip: 'provider_disabled',
        detail: gridSettingDiffers(found.name, found.worker, found.app),
      };
  }
}

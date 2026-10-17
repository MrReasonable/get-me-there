import { runMaintenance } from '@gmt/db';
import type { EngineContext } from './context.js';
import { errorText } from './errors.js';
import { refreshFx } from './fx/refresh.js';
import type { SystemJob } from './scheduler/scheduler.js';

/** Daily at 06:00 in SCHEDULER_TIMEZONE (spec §5.6 "refreshed daily"). */
export const FX_REFRESH_CRON = '0 6 * * *';
/** Daily at 03:30 in SCHEDULER_TIMEZONE (spec §7 "Retention. A daily maintenance job"). */
export const MAINTENANCE_CRON = '30 3 * * *';

/**
 * Spec §7 retention through WP3's runMaintenance (which logs its own `maintenance` line): expired cache rows, and
 * cache-hit ledger rows older than 90 days of providers on monthly windows; providers on lifetime windows keep every
 * row, because their cap counts them.
 */
export function runMaintenanceJob(ctx: EngineContext): ReturnType<typeof runMaintenance> {
  const lifetimeProviders = [...ctx.providers.keys()].filter((id) => ctx.limitsOf(id).window === 'lifetime');
  return runMaintenance(ctx.db, ctx.clock, ctx.log, { lifetimeProviders });
}

/** Runs a daily system job; failures are logged so a bad day never stops the scheduler. */
export async function runSystemJob(ctx: EngineContext, name: SystemJob): Promise<void> {
  try {
    if (name === 'fx-refresh') await refreshFx(ctx, new AbortController().signal);
    else runMaintenanceJob(ctx);
  } catch (err) {
    ctx.log.error({ job: name, err: errorText(err) }, 'system job failed');
  }
}

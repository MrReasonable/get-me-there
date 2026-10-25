import { runMaintenance } from '@gmt/db';
import type { EngineContext } from './context.js';
import { errorText } from './errors.js';
import { refreshFx } from './fx/refresh.js';
import { sendSystemNotice } from './notify.js';
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

/**
 * Spec §8.3 "Consent expiry": while the Status view's consent check is `warn` or `fail` and the browser provider is
 * enabled, one notice a London day to every notifier. The day's key `consent-expiring:<London date>` is claimed first
 * (`operator_notice_keys`, the store the cool-down notice uses) and only a successful claim sends. With no notifier
 * nothing is claimed or sent. No `operator_notifications` row, no `OperatorMessageKind`, no migration. Returns whether a
 * notice was sent.
 */
export async function runConsentNotice(ctx: EngineContext): Promise<boolean> {
  if (ctx.consentCheck === undefined || ctx.config.providers.camoufox === null) return false;
  const c = await ctx.consentCheck();
  if (c.state !== 'warn' && c.state !== 'fail') return false;
  if (ctx.notifiers.length === 0) return false;
  if (!ctx.repos.notifications.claimNoticeKey(`consent-expiring:${ctx.clock.todayLondon()}`)) return false;
  const next = c.fix === null ? '' : ` ${c.fix}.`;
  return sendSystemNotice(
    ctx,
    c.state === 'fail' ? 'browser provider consent has expired' : 'browser provider consent expires soon',
    `${c.summary}.${next} The Status view shows the same check.`,
  );
}

/** Runs a daily system job; failures are logged so a bad day never stops the scheduler. */
export async function runSystemJob(ctx: EngineContext, name: Exclude<SystemJob, 'catch-up'>): Promise<void> {
  try {
    // why: review S2 — a refresh still waiting on the network when the engine hands the database back is aborted
    if (name === 'fx-refresh') await refreshFx(ctx, ctx.lifecycle.abort.signal);
    else {
      runMaintenanceJob(ctx);
      await runConsentNotice(ctx);
    }
  } catch (err) {
    ctx.log.error({ job: name, err: errorText(err) }, 'system job failed');
  }
}

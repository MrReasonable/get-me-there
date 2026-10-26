/**
 * Spec §8.3 "Consent expiry": the notice that tells the operator the browser provider's consent is expiring or gone.
 * Its own file so its mutation scope is the whole file, run against test/consentNotice.test.ts.
 */
import type { EngineContext } from './context.js';
import { errorText } from './errors.js';
import { sendSystemNotice } from './notify.js';
import type { ConsentCause } from './types.js';

/** The words of each cause that is sent: the subject says what the check found, never more (V2). */
const CONSENT_SUBJECT: Readonly<Record<Exclude<ConsentCause, 'cannot-check' | 'none'>, string>> = {
  expiring: 'browser provider consent expires soon',
  expired: 'browser provider consent has expired',
  missing: 'browser provider has no consent record',
  // why: review X1: a stored choice whose value is not a rejection is never applied
  'not-rejection': 'browser provider consent is not a rejection',
};
const CONSENT_CONSEQUENCE =
  'Browser prices stop when consent lapses; the other price sources are unaffected.';
/** How often the minute job re-reads the consent check while today's notice is unsent. */
export const CONSENT_RECHECK_MS = 60 * 60_000;
const consentState = new WeakMap<object, { checkedAt: number; sending: boolean }>();

/**
 * Spec §8.3 "Consent expiry": while the Status view's consent check is `warn` or `fail` for a cause it can name and the
 * browser provider is enabled, one notice a London day to every notifier. The subject comes from the cause (expiring,
 * expired, missing, not a rejection); a check that cannot be made (the worker is down or unreadable) sends nothing, because the
 * worker card says that. The day's key `consent-expiring:<London date>` (`operator_notice_keys`) is claimed only after
 * a notice was sent, so a failed send is tried again on the next pass; an in-flight flag stops two passes (the daily
 * job and the minute job) sending twice. No `operator_notifications` row, no `OperatorMessageKind`, no migration.
 * Called by the 03:30 maintenance job (`force`) and by the minute job, which re-reads the check at most hourly, so a
 * machine asleep at 03:30 still sends. Returns whether a notice was sent.
 */
export async function runConsentNotice(ctx: EngineContext, o: { force?: boolean } = {}): Promise<boolean> {
  if (ctx.consentCheck === undefined || ctx.config.providers.camoufox === null) return false;
  if (ctx.notifiers.length === 0) return false;
  const key = `consent-expiring:${ctx.clock.todayLondon()}`;
  if (ctx.repos.notifications.noticeKeyClaimed(key)) return false;
  const st = consentState.get(ctx) ?? { checkedAt: Number.NEGATIVE_INFINITY, sending: false };
  consentState.set(ctx, st);
  const now = Date.parse(ctx.clock.now());
  if (st.sending || (o.force !== true && now - st.checkedAt < CONSENT_RECHECK_MS)) return false;
  st.sending = true;
  st.checkedAt = now;
  try {
    const c = await ctx.consentCheck();
    if ((c.state !== 'warn' && c.state !== 'fail') || c.cause === 'cannot-check' || c.cause === 'none')
      return false;
    const fix = c.fix === null ? '' : `\n\nWhat to do: ${c.fix.charAt(0).toUpperCase()}${c.fix.slice(1)}.`;
    const sent = await sendSystemNotice(
      ctx,
      CONSENT_SUBJECT[c.cause],
      `${c.summary}.\n\n${CONSENT_CONSEQUENCE}${fix}\n\nThe Status view shows the same check; so does pnpm gmt status --only consent.`,
    );
    if (sent) ctx.repos.notifications.claimNoticeKey(key);
    return sent;
  } finally {
    st.sending = false;
  }
}

/** The minute job's consent pass: a failure is logged and never stops the catch-up that called it. */
export async function runConsentNoticeSafely(ctx: EngineContext): Promise<void> {
  try {
    await runConsentNotice(ctx);
  } catch (err) {
    ctx.log.error({ err: errorText(err) }, 'consent notice failed');
  }
}

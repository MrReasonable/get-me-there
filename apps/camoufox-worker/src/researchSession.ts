import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkerConfig } from './config.js';
import { type DisplayEnv, headedEnv, NoDisplay } from './consentDriver.js';
import { type ObservedRequest, observe, type ResearchSession, researchRecord } from './consentResearch.js';
import { watchConsentWindow } from './consentWatch.js';
import type { CooldownStore } from './cooldown.js';
import type { MonthlyCounter } from './monthly.js';
import type { Pacer } from './pacer.js';
import { claim } from './pageClaim.js';
import type { RecordDeps } from './record.js';
import { writeRecording } from './recordWrite.js';
import { type EntryContext, EX_CONFIG, EX_UNAVAILABLE } from './run.js';
import { landingUrl } from './url.js';

/** What the person is asked in each research session (pinned by a test). */
export const RESEARCH_PROMPT = {
  reject:
    'Session 1 of 2: click **Reject all** in the window. Nothing else is needed; close the window when you’re done',
  accept:
    'Session 2 of 2: click **Accept all** in the window. Nothing else is needed; close the window when you’re done',
} as const;

/**
 * Research 17.0c (WP17 Task 17.4; ca-b1-019: beside the watch it shares with the `consent` command): two headed
 * sessions, each in a throwaway profile `<data>/probe-research-…` (deleted in a `finally`; the start-up sweep removes any
 * a killed run left), under the consent capture's guard, the lock, the pacer, the monthly counter and the cool-downs,
 * with one load of the landing page each. The display is checked before anything is reserved (CodeRabbit, PR #15). The
 * person clicks the button each session asks for; the tool only observes. A blocking page, before or after the choice,
 * cools down as on the server path. A session is kept only when the person's choice was submitted to the consent host
 * exactly once and a SOCS was set or changed after it, within the 10 minutes (W8); an account cookie, a window closed
 * before the choice, a timed-out window or a session without that SOCS records nothing. Then one recording: the
 * requests (names only), the one differing value when it is safe to keep, both SOCS cookies' fields, the settled views,
 * and the machine's `<os>-<arch>` and bundle in its meta.
 */
export async function consentResearch(
  ctx: EntryContext,
  cfg: WorkerConfig,
  deps: RecordDeps & { display: DisplayEnv },
  s: { pacer: Pacer; monthly: MonthlyCounter; cooldown: CooldownStore; day: string },
  meta: (extra: Record<string, unknown>) => Record<string, unknown>,
): Promise<number> {
  try {
    headedEnv(deps.display, deps.platform);
  } catch (e) {
    if (!(e instanceof NoDisplay)) throw e;
    ctx.err(e.message);
    return EX_CONFIG;
  }
  const sessions: ResearchSession[] = [];
  const views: Record<string, unknown> = {};
  for (const prompted of ['reject', 'accept'] as const) {
    const profile = join(
      ctx.dataDir,
      `probe-research-${prompted}-${Date.parse(deps.clock.now())}-${deps.pid}`,
    );
    mkdirSync(profile, { recursive: true, mode: 0o700 });
    const requests: ObservedRequest[] = [];
    try {
      await claim(s.pacer, s.monthly, 0, deps, ctx);
      const driver = deps.consentDriver(profile, (r) => {
        const o = observe(r);
        if (o !== null) requests.push(o);
      });
      try {
        await driver.launchHeaded(deps.display);
        ctx.out(RESEARCH_PROMPT[prompted]);
        await driver.load(landingUrl(cfg.pointOfSale));
        const w = await watchConsentWindow(driver, { timers: deps.timers, selectors: deps.selectors });
        const nothing = (why: string): number => {
          ctx.err(`session ${prompted}: ${why}; nothing recorded`);
          return EX_UNAVAILABLE;
        };
        if (w.ended === 'blocked' && w.blocked !== null) {
          const until = s.cooldown.start(w.blocked).until;
          return nothing(`stopped on ${w.blocked}; cooling down until ${until}`);
        }
        if (w.ended === 'account-cookie')
          return nothing('an account cookie appeared in the throwaway profile');
        if (w.ended === 'timed-out') return nothing('the window was left for 10 minutes');
        if (w.saves !== 1)
          return nothing(
            w.saves === 0
              ? 'no consent choice was submitted before the window closed'
              : `the consent choice was submitted ${w.saves} times`,
          );
        if (w.socs === null) return nothing('no SOCS was set after the consent choice');
        sessions.push({
          prompted,
          requests: [...requests],
          socs: { ...w.socs },
          socsBeforeChoice: w.socsBeforeChoice,
          hosts: w.hosts,
          ended: w.ended,
        });
        views[prompted] = {
          first: w.firstView,
          firstFacts: w.firstFacts,
          afterChoice: w.afterView,
          afterFacts: w.afterFacts,
        };
      } finally {
        await driver.close();
        s.pacer.release();
      }
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  }
  const [reject, accept] = sessions;
  if (reject === undefined || accept === undefined) return EX_UNAVAILABLE;
  const facts = { ...researchRecord(reject, accept), views };
  const path = writeRecording(
    deps.root,
    'consent-research',
    s.day,
    { facts, meta: meta({ profile: 'throwaway', sessions: 2 }) },
    [cfg.key.reveal()],
  );
  ctx.out(`recorded ${path}`);
  return 0;
}

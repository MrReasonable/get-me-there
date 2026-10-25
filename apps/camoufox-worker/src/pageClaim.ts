import type { Admission, MonthlyCounter } from './monthly.js';
import type { Pacer } from './pacer.js';
import { RecordingRefused } from './recordArgs.js';
import type { EntryContext } from './run.js';
import type { Timers } from './timers.js';

/**
 * The month's caps, then the shared pacer: a page past the monthly page cap (or with fewer scrolls left than its
 * moves, or a counts file that cannot be read) is refused before anything loads; the spacing is waited out once (fake
 * timers in tests); then the caps are checked again (cb-b1-005: a wait that crossed a window's end counts the page in
 * the window it loads in) and the page and its scrolls are reserved, never settled down (an over-count).
 */
export async function claim(
  pacer: Pacer,
  monthly: MonthlyCounter,
  scrolls: number,
  deps: { timers: Timers },
  ctx: EntryContext,
): Promise<void> {
  const admissible = (): Extract<Admission, { kind: 'ok' }> => {
    const a = monthly.check(scrolls);
    if (a.kind === 'counts-unreadable')
      throw new RecordingRefused(
        `the worker's monthly counts file is ${a.problem}; rewrite it with pnpm gmt browser counts`,
      );
    if (a.kind === 'monthly-cap')
      throw new RecordingRefused(`the worker's monthly page cap (${a.cap}) is reached until ${a.windowEnd}`);
    if (a.scrollAllowance < scrolls)
      throw new RecordingRefused(
        `the worker's monthly scroll cap leaves ${a.scrollAllowance} of the ${scrolls} moves`,
      );
    return a;
  };
  admissible();
  const first = pacer.claim();
  if (!first.ok) {
    ctx.out(`waiting ${first.retryAfterSeconds} s for the spacing`);
    await deps.timers.sleep(first.retryAfterSeconds * 1000);
    const second = pacer.claim();
    if (!second.ok) throw new RecordingRefused(`the spacing still refuses (${second.retryAfterSeconds} s)`);
  }
  // why: no await between this check and the write, and the worker's lock keeps every other caller out
  monthly.write(admissible().reserved);
}

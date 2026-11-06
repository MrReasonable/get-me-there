import type { Pacer } from './pacer.js';
import { RecordingRefused } from './recordArgs.js';
import type { EntryContext } from './run.js';
import type { Timers } from './timers.js';

/**
 * The shared pacer before a recording's page: the spacing is waited out once (fake timers in tests), then claimed
 * again; a spacing that still refuses is a refusal before anything loads.
 */
export async function claim(
  pacer: Pacer,
  /** `interrupted` (the consent command's SIGINT or SIGTERM) ends the spacing wait at once, so nothing is claimed. */
  deps: { timers: Timers; interrupted?: AbortSignal },
  ctx: EntryContext,
): Promise<void> {
  const first = pacer.claim();
  if (first.ok) return;
  ctx.out(`waiting ${first.retryAfterSeconds} s for the spacing`);
  await deps.timers.sleep(first.retryAfterSeconds * 1000, deps.interrupted);
  const second = pacer.claim();
  if (!second.ok) throw new RecordingRefused(`the spacing still refuses (${second.retryAfterSeconds} s)`);
}

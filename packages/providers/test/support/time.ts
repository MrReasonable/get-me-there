import { vi } from 'vitest';

/** Fakes the timers http-kit, p-retry and bottleneck use; setImmediate, nextTick and queueMicrotask stay real. */
export function useFakeTime(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
}

/** Advances fake time in steps until `p` settles, then returns or rethrows its result. */
export async function drive<T>(p: Promise<T>, opts: { stepMs?: number; maxMs?: number } = {}): Promise<T> {
  const stepMs = opts.stepMs ?? 250;
  const maxMs = opts.maxMs ?? 600_000;
  let settled = false;
  const tracked = p.then(
    (v) => {
      settled = true;
      return v;
    },
    (e: unknown) => {
      settled = true;
      throw e;
    },
  );
  tracked.catch(() => undefined);
  for (let t = 0; t < maxMs && !settled; t += stepMs) {
    await vi.advanceTimersByTimeAsync(stepMs);
    // why: one real macrotask per step lets undici and msw finish work queued with setImmediate.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (!settled) throw new Error(`drive: promise did not settle within ${maxMs} ms of fake time`);
  return tracked;
}

/** Settles `p` and returns the rejection reason (fails the test if it resolves). */
export async function driveError(
  p: Promise<unknown>,
  opts?: { stepMs?: number; maxMs?: number },
): Promise<unknown> {
  try {
    await drive(p, opts);
  } catch (e) {
    return e;
  }
  throw new Error('expected the request to fail');
}

/** Advances fake time by `ms` with real macrotask turns in between (for "nothing else happens later" checks). */
export async function idle(ms: number, stepMs = 1000): Promise<void> {
  for (let t = 0; t < ms; t += stepMs) {
    await vi.advanceTimersByTimeAsync(stepMs);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

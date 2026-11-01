// Spec revision 55 §8.1 "Reading one date pair's flights": the browser lease is one in-flight slot, held only by the
// on-demand read; every browser page of a pass waits for it to be free. Event-driven: deferred promises, no timers.
import { AbortedError } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { createBrowserLease } from '../src/browserLease.js';

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } {
  let resolve: () => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createBrowserLease', () => {
  it('hold succeeds once and refuses while the first is pending; inFlight follows it', async () => {
    const lease = createBrowserLease();
    expect(lease.inFlight()).toBe(false);
    const d = deferred();
    expect(lease.hold(d.promise)).toBe(true);
    expect(lease.inFlight()).toBe(true);
    expect(lease.hold(deferred().promise)).toBe(false);
    d.resolve();
    await lease.whenFree(new AbortController().signal);
    expect(lease.inFlight()).toBe(false);
    expect(lease.hold(deferred().promise)).toBe(true);
  });

  it('whenFree resolves at once when nothing holds it', async () => {
    await expect(createBrowserLease().whenFree(new AbortController().signal)).resolves.toBeUndefined();
  });

  it('whenFree resolves when the held promise settles, a rejection included', async () => {
    const lease = createBrowserLease();
    const d = deferred();
    lease.hold(d.promise);
    let freed = false;
    const waiting = lease.whenFree(new AbortController().signal).then(() => {
      freed = true;
    });
    await Promise.resolve();
    expect(freed).toBe(false);
    d.reject(new Error('the read threw'));
    await waiting;
    expect(freed).toBe(true);
    expect(lease.inFlight()).toBe(false);
  });

  it('whenFree rejects with AbortedError when its signal aborts first, and the lease stays held', async () => {
    const lease = createBrowserLease();
    const d = deferred();
    lease.hold(d.promise);
    const c = new AbortController();
    const waiting = lease.whenFree(c.signal);
    c.abort();
    await expect(waiting).rejects.toBeInstanceOf(AbortedError);
    expect(lease.inFlight()).toBe(true);
    d.resolve();
  });

  it('whenFree rejects at once on a signal already aborted', async () => {
    const c = new AbortController();
    c.abort();
    await expect(createBrowserLease().whenFree(c.signal)).rejects.toBeInstanceOf(AbortedError);
  });
});

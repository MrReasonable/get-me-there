// Settings plan ruling 6: the reloader alone. A save with nothing in flight restarts once, after the caller's turn; a
// save during runs holds the engine and restarts on the first settle that finds nothing in flight; two saves give one
// restart; a signal's close stops any restart still waiting; a check that throws is logged, never thrown into the run
// registry's settle.
import { Secret } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { createReloader } from '../../src/bootstrap/reload.js';
import { createLogger } from '../../src/logger.js';
import { captureLines } from '../helpers/harness.js';

function setup(o: { idle?: () => boolean } = {}) {
  const calls: string[] = [];
  let busy = true;
  const lines: string[] = [];
  const secret = new Secret('reload-test-secret-0123456789');
  const reloader = createReloader({
    idle: o.idle ?? (() => !busy),
    hold: () => calls.push('hold'),
    reload: () => calls.push('reload'),
    log: createLogger({ logLevel: 'info' }, { destination: captureLines(lines), secrets: [secret] }),
    secrets: [secret],
  });
  return { reloader, calls, lines, secret, setBusy: (b: boolean) => (busy = b) };
}

/** Lets the microtask the restart is queued on run. */
const turn = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('createReloader (settings plan ruling 6)', () => {
  it('idle: answers now, holds the engine and restarts once, after the caller has answered', async () => {
    const { reloader, calls, setBusy } = setup();
    setBusy(false);
    expect(reloader.request()).toBe('now');
    expect(calls).toEqual(['hold']);
    await turn();
    expect(calls).toEqual(['hold', 'reload']);
    expect(reloader.request()).toBe('now');
    reloader.watch.ended();
    await turn();
    expect(calls).toEqual(['hold', 'reload']);
    expect(reloader.pending()).toBe(false);
  });

  it('busy: answers after-runs; two saves hold once and restart once, on the first settle with nothing in flight', async () => {
    const { reloader, calls, setBusy } = setup();
    expect(reloader.request()).toBe('after-runs');
    expect(reloader.request()).toBe('after-runs');
    expect(reloader.pending()).toBe(true);
    reloader.watch.started();
    reloader.watch.ended();
    await turn();
    expect(calls).toEqual(['hold']);
    setBusy(false);
    reloader.watch.ended();
    reloader.watch.ended();
    await turn();
    expect(calls).toEqual(['hold', 'reload']);
    expect(reloader.pending()).toBe(false);
  });

  it('a settle before any save restarts nothing', async () => {
    const { reloader, calls, setBusy } = setup();
    setBusy(false);
    reloader.watch.ended();
    await turn();
    expect(calls).toEqual([]);
  });

  it("a signal's close stops a restart still waiting", async () => {
    const { reloader, calls, setBusy } = setup();
    expect(reloader.request()).toBe('after-runs');
    reloader.stop();
    expect(reloader.pending()).toBe(false);
    setBusy(false);
    reloader.watch.ended();
    await turn();
    expect(calls).toEqual(['hold']);
  });

  it('a check that throws on a settle is logged, scrubbed, and never thrown', async () => {
    let fail = false;
    const { reloader, calls, lines, secret } = setup({
      idle: () => {
        if (fail) throw new Error(`database closed at ${secret.reveal()}`);
        return false;
      },
    });
    expect(reloader.request()).toBe('after-runs');
    fail = true;
    expect(() => reloader.watch.ended()).not.toThrow();
    await turn();
    expect(calls).toEqual(['hold']);
    expect(lines.join('')).toContain('restart check failed');
    expect(lines.join('')).not.toContain(secret.reveal());
  });
});

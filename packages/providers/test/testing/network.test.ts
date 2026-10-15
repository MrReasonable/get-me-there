import dns from 'node:dns';
import { describe, expect, it } from 'vitest';
import {
  guardedServer,
  hangUntilAborted,
  installNetworkGuards,
  takeStrays,
} from '../../src/testing/network.js';

// why: the guards that keep every test off the real network are themselves tested, so a guard that silently stopped
// working fails here rather than at the first real escape (test-strategy minor 1). This package's setup file installs
// them through the same function other packages use.
describe('network guards (@gmt/providers/testing installNetworkGuards)', () => {
  it('answers a request no handler matches with a network error and records it as a stray', async () => {
    await expect(fetch('https://unhandled.example/path?secret=x')).rejects.toThrow();
    expect(takeStrays()).toEqual(['GET https://unhandled.example/path']);
    expect(takeStrays()).toEqual([]);
  });

  it('refuses every DNS lookup in the process with ENOTFOUND', async () => {
    const code = await new Promise<unknown>((resolve) =>
      dns.lookup('example.com', (err) => resolve(err !== null && 'code' in err ? err.code : 'no error')),
    );
    expect(code).toBe('ENOTFOUND');
    const withOptions = await new Promise<unknown>((resolve) =>
      dns.lookup('example.com', { family: 4 }, (err) => resolve(err?.code)),
    );
    expect(withOptions).toBe('ENOTFOUND');
  });

  it('the afterEach it installs fails a test that left a stray, and clears it', async () => {
    const hooks: Array<() => unknown> = [];
    installNetworkGuards({
      beforeAll: () => undefined,
      afterEach: (fn) => hooks.push(fn),
      afterAll: () => undefined,
    });
    await expect(fetch('https://unhandled.example/again')).rejects.toThrow();
    const afterEachHook = hooks[0];
    expect(afterEachHook).toBeTypeOf('function');
    expect(() => afterEachHook?.()).toThrow(/no handler answered.*unhandled\.example\/again/);
    expect(takeStrays()).toEqual([]);
  });

  it('hangUntilAborted settles with a network error when the client aborts', async () => {
    const ac = new AbortController();
    const p = hangUntilAborted(new Request('https://x.example/', { signal: ac.signal }));
    ac.abort();
    expect((await p).type).toBe('error');
    expect(guardedServer.listHandlers().length).toBeGreaterThan(0);
  });
});

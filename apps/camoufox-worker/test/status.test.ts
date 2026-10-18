import { createServer } from 'node:http';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EntryContext } from '../src/run.js';
import { EX_UNAVAILABLE } from '../src/run.js';
import { portOf } from '../src/server.js';
import { status } from '../src/status.js';

const KEY = 'synthetic-worker-key-0123456789abcdef';
const BODY = {
  ok: true,
  coolingDownUntil: null,
  cooldownCause: null,
  signedInRefusal: false,
  lastPageAt: null,
  busySince: null,
  versions: { selectors: 's', grammar: 'g', camoufoxJs: '0.11.5', binary: '152.0.4-beta.28' },
  flags: { RESULTS_VERIFIED: true },
  accountCookie: { found: false, names: [], checkedAt: '2026-10-18T05:00:00.000Z' },
  socsCapturedAt: '2026-10-18T04:00:00.000Z',
  socsStable: false,
  cooldownHours: 48,
  pageTimeoutSeconds: 90,
};
async function serve(answer: (key: string | undefined) => [number, unknown]) {
  const s = createServer((req, res) => {
    const h = req.headers['x-gmt-worker-key'];
    const [code, body] = answer(typeof h === 'string' ? h : undefined);
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  return { port: portOf(s), close: () => new Promise((r) => s.close(r)) };
}
function ctx(port: number) {
  const p = port < 1024 ? 8090 : port;
  const out: string[] = [];
  const err: string[] = [];
  const c: EntryContext = {
    env: { CAMOUFOX_WORKER_KEY: KEY, HOME: '/h', CAMOUFOX_WORKER_PORT: String(p) },
    dataDir: '/d',
    args: [],
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  };
  return { c, out, err };
}

beforeEach(() => {
  expect.hasAssertions();
});

describe('the status script (SEC-R2-005: the key never on a command line)', () => {
  it('reads the key from the env file and prints the status body without the key', async () => {
    const srv = await serve((k) => (k === KEY ? [200, BODY] : [401, {}]));
    try {
      const t = ctx(srv.port);
      expect(await status(t.c)).toBe(0);
      expect(JSON.parse(t.out.join(''))).toEqual(BODY);
      expect(t.out.join('')).not.toContain(KEY);
    } finally {
      await srv.close();
    }
  });
  it('a refused key, an unreadable body and an unreachable worker exit 69', async () => {
    const srv = await serve(() => [401, {}]);
    const bad = await serve(() => [200, { ok: true }]);
    try {
      expect(await status(ctx(srv.port).c)).toBe(EX_UNAVAILABLE);
      const t = ctx(bad.port);
      expect(await status(t.c)).toBe(EX_UNAVAILABLE);
      expect(t.err.join()).toMatch(/cannot read/);
      const u = ctx(9);
      expect(
        await status(u.c, async () => {
          throw new TypeError('fetch failed');
        }),
      ).toBe(EX_UNAVAILABLE);
      expect(u.err.join()).toMatch(/not reachable/);
    } finally {
      await srv.close();
      await bad.close();
    }
  });
});

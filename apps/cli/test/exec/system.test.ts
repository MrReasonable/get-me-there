import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Runner } from '../../src/exec/runner.js';
import { entryProblem, systemExecutor } from '../../src/exec/system.js';
import { runAction } from '../../src/plan/action.js';
import { killTracked } from '../support/children.js';

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  // why: PR #11: no real child outlives its test
  expect(killTracked()).toEqual([]);
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'gmt-sysexec-'));
  dirs.push(d);
  return d;
};
const mode = (p: string) => statSync(p).mode & 0o777;
// why: PR #11: this file starts no real child (Stryker runs it per mutant, and a worker killed mid-spawn can leave a
// child stuck); a step that would start one fails the test instead. system-children.test.ts has the real ones.
const noChild: Runner = async (argv) => {
  throw new Error(`this test starts no child process (asked for ${argv.join(' ')})`);
};
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

// why: the health wait is tried against a real loopback server: one that answers, and one that accepts and never answers
let server: Server;
let silent: Server;
let base = '';
let silentBase = '';
let health: Array<{ status: number; body: string }> = [];
const port = (s: Server) => {
  const addr = s.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  return addr.port;
};
beforeAll(async () => {
  server = createServer((req, res) => {
    const h = health.length > 1 ? health.shift() : health[0];
    res.writeHead(req.url === '/api/health' ? (h?.status ?? 503) : 404, {
      'content-type': 'application/json',
    });
    res.end(h?.body ?? '{}');
  });
  silent = createServer(() => {});
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  await new Promise<void>((r) => silent.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${port(server)}`;
  silentBase = `http://127.0.0.1:${port(silent)}`;
});
afterAll(() => {
  server.close();
  silent.closeAllConnections();
  silent.close();
});

/** A fetch over a table of URLs: a body, a status, or a redirect; every requested URL is recorded. */
function fakeFetch(table: Record<string, { status: number; body?: Buffer; location?: string }>) {
  const seen: Array<{ url: string; redirect: unknown }> = [];
  const f: typeof fetch = async (input, init) => {
    const url = String(input);
    seen.push({ url, redirect: init?.redirect });
    const e = table[url];
    if (e === undefined) return new Response(null, { status: 404 });
    return new Response(e.body === undefined ? null : new Uint8Array(e.body), {
      status: e.status,
      headers: e.location === undefined ? {} : { location: e.location },
    });
  };
  return Object.assign(f, { seen });
}
const BLOB = Buffer.from('a'.repeat(200_000));
const REL = 'https://github.com/daijro/camoufox/releases/download/v1/a.zip';
const ASSET = 'https://release-assets.githubusercontent.com/x/a.zip';

describe.skipIf(process.platform === 'win32')(
  'systemExecutor (temporary directory; POSIX modes)',
  { timeout: 30_000 },
  () => {
    const ex = systemExecutor(noChild, { sleep: async () => {} });

    it('writeFile writes a sibling temporary file with its mode and renames it, under umask 022', async () => {
      const d = tmp();
      const old = process.umask(0o022);
      try {
        await ex.run({
          kind: 'writeFile',
          path: join(d, 'app.env'),
          contents: 'A="1"\n',
          mode: 0o600,
          secret: true,
        });
        await ex.run({
          kind: 'writeFile',
          path: join(d, 'unit.plist'),
          contents: 'p',
          mode: 0o644,
          secret: false,
        });
      } finally {
        process.umask(old);
      }
      expect(readFileSync(join(d, 'app.env'), 'utf8')).toBe('A="1"\n');
      expect(mode(join(d, 'app.env'))).toBe(0o600);
      expect(mode(join(d, 'unit.plist'))).toBe(0o644);
      expect(readdirSync(d).sort()).toEqual(['app.env', 'unit.plist']);
      writeFileSync(join(d, 'old.env'), 'x', { mode: 0o644 });
      await ex.run({ kind: 'writeFile', path: join(d, 'old.env'), contents: 'y', mode: 0o600, secret: true });
      expect([readFileSync(join(d, 'old.env'), 'utf8'), mode(join(d, 'old.env'))]).toEqual(['y', 0o600]);
    });

    it('the temporary file is never wider than its target: it exists at its mode, empty, before any data (onTemporary)', async () => {
      // why: Ian's rule: no polling. The executor calls onTemporary once the file exists and before it writes, so the
      // mode is read at exactly that moment.
      const d = tmp();
      const seen: Array<[number, number]> = [];
      const e = systemExecutor(noChild, {
        onTemporary: async (t) => {
          seen.push([mode(t), statSync(t).size]);
        },
      });
      await e.run({
        kind: 'writeFile',
        path: join(d, 's.env'),
        contents: 'secret',
        mode: 0o600,
        secret: true,
      });
      writeFileSync(join(d, 'src.db'), 'data', { mode: 0o644 });
      await e.run({ kind: 'copy', from: join(d, 'src.db'), to: join(d, 'dst.db'), mode: 0o600 });
      expect(seen).toEqual([
        [0o600, 0],
        [0o600, 0],
      ]);
      expect(mode(join(d, 'dst.db'))).toBe(0o600);
    });
    it('a write whose temporary file was never made reports the write’s own error and leaves the old file', async () => {
      const d = tmp();
      writeFileSync(join(d, 'f'), 'old');
      await expect(
        ex.run({
          kind: 'writeFile',
          path: join(d, 'missing', 'f'),
          contents: 'x',
          mode: 0o600,
          secret: true,
        }),
      ).rejects.toMatchObject({
        syscall: 'open',
        code: 'ENOENT',
      });
      expect(readdirSync(d)).toEqual(['f']);
    });

    it('mkdir applies its mode whatever the umask, and tightens an existing directory', async () => {
      const d = tmp();
      const old = process.umask(0o077);
      try {
        await ex.run({ kind: 'mkdir', path: join(d, 'a', 'b'), mode: 0o755 });
        expect(mode(join(d, 'a', 'b'))).toBe(0o755);
        await ex.run({ kind: 'mkdir', path: join(d, 'a', 'b'), mode: 0o700 });
      } finally {
        process.umask(old);
      }
      expect(mode(join(d, 'a', 'b'))).toBe(0o700);
    });

    it('copy writes through a temporary file and renames, with its mode; a missing source leaves nothing', async () => {
      const d = tmp();
      writeFileSync(join(d, 'src.db'), 'database bytes', { mode: 0o644 });
      await ex.run({ kind: 'copy', from: join(d, 'src.db'), to: join(d, 'dst.db'), mode: 0o600 });
      expect([readFileSync(join(d, 'dst.db'), 'utf8'), mode(join(d, 'dst.db'))]).toEqual([
        'database bytes',
        0o600,
      ]);
      await expect(
        ex.run({ kind: 'copy', from: join(d, 'none'), to: join(d, 'x'), mode: 0o600 }),
      ).rejects.toThrow();
      expect(readdirSync(d).sort()).toEqual(['dst.db', 'src.db']);
    });

    it('rename and remove (a missing path is no error; recursive removes a tree)', async () => {
      const d = tmp();
      writeFileSync(join(d, 'a'), '1');
      await ex.run({ kind: 'rename', from: join(d, 'a'), to: join(d, 'b') });
      expect(readFileSync(join(d, 'b'), 'utf8')).toBe('1');
      await ex.run({ kind: 'remove', path: join(d, 'b'), recursive: false });
      await ex.run({ kind: 'remove', path: join(d, 'b'), recursive: false });
      mkdirSync(join(d, 't', 'u'), { recursive: true });
      writeFileSync(join(d, 't', 'u', 'f'), 'x');
      await expect(ex.run({ kind: 'remove', path: join(d, 't'), recursive: false })).rejects.toThrow();
      await ex.run({ kind: 'remove', path: join(d, 't'), recursive: true });
      expect(readdirSync(d)).toEqual([]);
    });

    it('run passes the argv and the input on stdin to the runner and resolves its stdout (a stand-in runner)', async () => {
      const calls: Array<{ argv: readonly string[]; cwd: string; stdin: string | undefined }> = [];
      const r: Runner = async (argv, opts) => {
        calls.push({ argv, cwd: opts.cwd, stdin: opts.stdin });
        return { code: 0, stdout: 'printed\n', stderr: '' };
      };
      const out = await systemExecutor(r).run(
        runAction(['tool', '$HOME;x'], '/work', { stdin: { text: 'SECRET-on-stdin', secret: true } }),
      );
      expect(out).toEqual({ stdout: 'printed\n' });
      expect(calls).toEqual([{ argv: ['tool', '$HOME;x'], cwd: '/work', stdin: 'SECRET-on-stdin' }]);
    });
    it('unpack lists, then extracts into a fresh 0700 directory beside the target and moves it in, making the parent (a stand-in runner)', async () => {
      const d = tmp();
      const calls: Array<readonly string[]> = [];
      const r: Runner = async (argv) => {
        calls.push(argv);
        if (argv[1] === '-tf' || argv[1] === '-Z1') return { code: 0, stdout: 'inner/f.txt\n', stderr: '' };
        const into = String(argv[4]);
        mkdirSync(join(into, 'inner'), { recursive: true });
        writeFileSync(join(into, 'inner', 'f.txt'), 'packed');
        return { code: 0, stdout: '', stderr: '' };
      };
      writeFileSync(join(d, 'a.tar'), 'tar bytes');
      await systemExecutor(r).run({
        kind: 'unpack',
        archive: join(d, 'a.tar'),
        sha256: sha('tar bytes'),
        to: join(d, 'nested', 'deep', 'out'),
      });
      expect(readFileSync(join(d, 'nested', 'deep', 'out', 'inner', 'f.txt'), 'utf8')).toBe('packed');
      expect(mode(join(d, 'nested', 'deep', 'out'))).toBe(0o700);
      expect(readdirSync(join(d, 'nested', 'deep'))).toEqual(['out']);
      expect(calls.map((c) => c.slice(0, 2))).toEqual([
        ['tar', '-tf'],
        ['tar', '-xf'],
      ]);
      writeFileSync(join(d, 'b.zip'), 'zip bytes');
      await systemExecutor(r).run({
        kind: 'unpack',
        archive: join(d, 'b.zip'),
        sha256: sha('zip bytes'),
        to: join(d, 'zout'),
      });
      expect(readFileSync(join(d, 'zout', 'inner', 'f.txt'), 'utf8')).toBe('packed');
      expect(calls.slice(-2).map((c) => [c[0], c[1], c[3]])).toEqual([
        ['unzip', '-Z1', undefined],
        ['unzip', '-q', '-d'],
      ]);
    });
    it('run passes stdin and env only when the action has them, with the default or given timeout', async () => {
      const seen: Array<Record<string, unknown>> = [];
      const spy: Runner = async (_argv, opts) => {
        seen.push({ ...opts });
        return { code: 0, stdout: '', stderr: '' };
      };
      await systemExecutor(spy).run(runAction(['x'], '/'));
      await systemExecutor(spy, { runTimeoutMs: 5 }).run(
        runAction(['x'], '/', { stdin: { text: '', secret: false }, env: { PATH: '/bin', HOME: '/h' } }),
      );
      expect(seen).toEqual([
        { cwd: '/', timeoutMs: 30 * 60_000 },
        { cwd: '/', timeoutMs: 5, stdin: '', env: { PATH: '/bin', HOME: '/h' } },
      ]);
    });

    it('a failure shows only the last line of stderr, nothing after the code when stderr is empty, and never a secret run’s stderr', async () => {
      const fail =
        (stderr: string): Runner =>
        async () => ({ code: 2, stdout: '', stderr });
      await expect(
        systemExecutor(fail('first\nlast line\n')).run(runAction(['x'], '/', { describe: 'step' })),
      ).rejects.toThrow(/^step exited with 2: last line$/);
      await expect(systemExecutor(fail('')).run(runAction(['x'], '/', { describe: 'step' }))).rejects.toThrow(
        /^step exited with 2$/,
      );
      await expect(
        systemExecutor(fail('SENTINEL the secret\n')).run(
          runAction(['x'], '/', { describe: 'step', stdin: { text: 'SENTINEL', secret: true } }),
        ),
      ).rejects.toThrow(/^step exited with 2$/);
    });

    it('download: https on a release host, redirects followed by hand to release hosts only, hashed, 0600, moved into place', async () => {
      const d = tmp();
      const f = fakeFetch({ [REL]: { status: 302, location: ASSET }, [ASSET]: { status: 200, body: BLOB } });
      await systemExecutor(noChild, { fetch: f }).run({
        kind: 'download',
        url: REL,
        to: join(d, 'a.zip'),
        sha256: sha(BLOB),
        bytes: BLOB.length,
      });
      expect(readFileSync(join(d, 'a.zip')).equals(BLOB)).toBe(true);
      expect(mode(join(d, 'a.zip'))).toBe(0o600);
      expect(f.seen).toEqual([
        { url: REL, redirect: 'manual' },
        { url: ASSET, redirect: 'manual' },
      ]);
      expect(readdirSync(d)).toEqual(['a.zip']);
    });
    it.each([
      ['plain http', 'http://github.com/x.zip', {}],
      ['another host', 'https://example.com/x.zip', {}],
      [
        'a redirect to http',
        REL,
        { [REL]: { status: 302, location: 'http://objects.githubusercontent.com/x' } },
      ],
      [
        'a redirect off the release hosts',
        REL,
        { [REL]: { status: 302, location: 'https://cdn.example.com/x' } },
      ],
    ])('download refuses %s, writing nothing', async (_n, url, table) => {
      const d = tmp();
      const f = fakeFetch(table);
      await expect(
        systemExecutor(noChild, { fetch: f }).run({
          kind: 'download',
          url,
          to: join(d, 'x'),
          sha256: sha(BLOB),
          bytes: 1,
        }),
      ).rejects.toThrow('refused');
      expect(readdirSync(d)).toEqual([]);
    });
    it('download refuses a size or hash mismatch, a non-2xx answer and endless redirects, removing the partial file; a stale part is replaced', async () => {
      const d = tmp();
      const ok = fakeFetch({ [REL]: { status: 200, body: BLOB } });
      const run = (f: typeof fetch, s: string, bytes: number) =>
        systemExecutor(noChild, { fetch: f }).run({
          kind: 'download',
          url: REL,
          to: join(d, 'a'),
          sha256: s,
          bytes,
        });
      writeFileSync(join(d, 'a.part'), 'stale');
      await expect(run(ok, sha('other'), BLOB.length)).rejects.toThrow('sha256');
      await expect(run(ok, sha(BLOB), 10)).rejects.toThrow('more than 10 bytes');
      await expect(run(ok, sha(BLOB), BLOB.length + 1)).rejects.toThrow(/bytes, expected/);
      await expect(run(fakeFetch({ [REL]: { status: 404 } }), sha(BLOB), 1)).rejects.toThrow(/answered 404$/);
      await expect(run(fakeFetch({ [REL]: { status: 302, location: REL } }), sha(BLOB), 1)).rejects.toThrow(
        'more than 5 redirects',
      );
      expect(readdirSync(d)).toEqual([]);
    });

    it('entryProblem refuses absolute, .. and escaping entries', () => {
      for (const e of ['inner/f.txt', 'a/b/', 'Camoufox.app/Contents/x', ''])
        expect(entryProblem(e)).toBeNull();
      for (const e of ['/etc/passwd', '../x', 'a/../../x', 'a/..', 'C:/x'])
        expect(entryProblem(e)).not.toBeNull();
    });

    it('unpack refuses a hash mismatch and an escaping entry before unpacking anything', async () => {
      const d = tmp();
      writeFileSync(join(d, 'a.zip'), 'not really');
      await expect(
        systemExecutor(noChild).run({
          kind: 'unpack',
          archive: join(d, 'a.zip'),
          sha256: sha('x'),
          to: join(d, 'out'),
        }),
      ).rejects.toThrow('sha256');
      const listing: Runner = async (argv) =>
        argv[1] === '-tf'
          ? { code: 0, stdout: 'ok/a\n../evil\n', stderr: '' }
          : { code: 0, stdout: '', stderr: '' };
      writeFileSync(join(d, 'b.tar'), 'x');
      await expect(
        systemExecutor(listing).run({
          kind: 'unpack',
          archive: join(d, 'b.tar'),
          sha256: sha('x'),
          to: join(d, 'out'),
        }),
      ).rejects.toThrow('../evil leaves the archive');
      expect(readdirSync(d).sort()).toEqual(['a.zip', 'b.tar']);
    });
    it('a failed extraction that left files is reported by its own error and leaves no temporary directory', async () => {
      const d = tmp();
      writeFileSync(join(d, 'c.tar'), 'x');
      const partial: Runner = async (argv) => {
        if (argv[1] === '-tf') return { code: 0, stdout: 'inner/f\n', stderr: '' };
        const into = String(argv.at(-1));
        mkdirSync(join(into, 'inner'), { recursive: true });
        writeFileSync(join(into, 'inner', 'f'), 'half');
        return { code: 2, stdout: '', stderr: 'truncated' };
      };
      await expect(
        systemExecutor(partial).run({
          kind: 'unpack',
          archive: join(d, 'c.tar'),
          sha256: sha('x'),
          to: join(d, 'cout'),
        }),
      ).rejects.toThrow(`unpacking ${join(d, 'c.tar')} exited with 2`);
      expect(readdirSync(d)).toEqual(['c.tar']);
    });

    it('waitHealthy tries until /api/health answers ok, sleeping 2 s between tries, and fails at its deadline inclusive', async () => {
      health = [
        { status: 503, body: '{}' },
        { status: 200, body: '{"ok":false,"degraded":false}' },
        { status: 200, body: 'not json' },
        { status: 200, body: '{"ok":true,"degraded":false}' },
      ];
      const sleeps: number[] = [];
      await systemExecutor(noChild, { sleep: async (ms) => void sleeps.push(ms) }).run({
        kind: 'waitHealthy',
        url: `${base}/api/health`,
        timeoutSeconds: 30,
      });
      expect(sleeps).toEqual([2000, 2000, 2000]);
      health = [{ status: 503, body: '{}' }];
      let clock = 0;
      const late: number[] = [];
      const e = systemExecutor(noChild, {
        sleep: async (ms) => {
          late.push(ms);
          clock += ms;
        },
        now: () => clock,
      });
      await expect(
        e.run({ kind: 'waitHealthy', url: `${base}/api/health`, timeoutSeconds: 10 }),
      ).rejects.toThrow('did not answer healthy within 10 s');
      expect(late).toEqual([2000, 2000, 2000, 2000, 2000]);
    });
    it('a server that accepts and never answers is one failed try, bounded by the try timeout', async () => {
      let clock = 0;
      const started = Date.now();
      const e = systemExecutor(noChild, {
        healthTryMs: 200,
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      });
      await expect(
        e.run({ kind: 'waitHealthy', url: `${silentBase}/api/health`, timeoutSeconds: 2 }),
      ).rejects.toThrow('within 2 s');
      expect(Date.now() - started).toBeLessThan(5000);
    });
    it('the default pause between tries is a 2 s timer and the default clock the real one', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      health = [
        { status: 503, body: '{}' },
        { status: 200, body: '{"ok":true}' },
      ];
      const done = systemExecutor(noChild).run({
        kind: 'waitHealthy',
        url: `${base}/api/health`,
        timeoutSeconds: 30,
      });
      let settled = false;
      void done.then(() => {
        settled = true;
      });
      await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
      await vi.advanceTimersByTimeAsync(1999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await done;
      vi.useRealTimers();
      health = [{ status: 503, body: '{}' }];
      await expect(
        systemExecutor(noChild).run({
          kind: 'waitHealthy',
          url: `${base}/api/health`,
          timeoutSeconds: 0,
        }),
      ).rejects.toThrow('within 0 s');
    });
  },
);

// why: Ian's ruling on PR #11 (survivors before merge): the bounded waits, the redirect rules, the archive-entry rule
// and the health answer, asserted as behaviour
describe('systemExecutor: waits, redirects and answers (survivors, PR #11)', () => {
  const probe = (codes: number[]) => {
    const calls: Array<{ argv: readonly string[]; cwd: string; timeoutMs: number }> = [];
    const r: Runner = async (argv, opts) => {
      calls.push({ argv, cwd: opts.cwd, timeoutMs: opts.timeoutMs });
      return { code: codes.length > 1 ? (codes.shift() ?? 0) : (codes[0] ?? 0), stdout: '', stderr: '' };
    };
    return { r, calls };
  };
  it('waitGone probes until the command fails, a second apart, each probe from / with a 15 s bound', async () => {
    const { r, calls } = probe([0, 0, 113]);
    const sleeps: number[] = [];
    let clock = 0;
    const e = systemExecutor(r, { sleep: async (ms) => void sleeps.push(ms), now: () => clock });
    expect(
      await e.run({
        kind: 'waitGone',
        argv: ['launchctl', 'print', 'gui/501/x'],
        describe: 'x',
        timeoutSeconds: 45,
      }),
    ).toEqual({ stdout: '' });
    expect(calls).toEqual([
      { argv: ['launchctl', 'print', 'gui/501/x'], cwd: '/', timeoutMs: 15_000 },
      { argv: ['launchctl', 'print', 'gui/501/x'], cwd: '/', timeoutMs: 15_000 },
      { argv: ['launchctl', 'print', 'gui/501/x'], cwd: '/', timeoutMs: 15_000 },
    ]);
    expect(sleeps).toEqual([1000, 1000]);
    clock = 0;
  });
  it('waitGone fails once its deadline is reached, inclusive, naming what still answers', async () => {
    const { r, calls } = probe([0]);
    let clock = 0;
    const e = systemExecutor(r, {
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });
    await expect(
      e.run({
        kind: 'waitGone',
        argv: ['launchctl', 'print', 'gui/501/x'],
        describe: 'the app agent',
        timeoutSeconds: 3,
      }),
    ).rejects.toThrow('the app agent still answers after 3 s');
    // probes at 0, 1, 2 and 3 s: the one at the deadline still counts
    expect(calls).toHaveLength(4);
  });
  it('a 3xx is followed only with a Location; a 200 or a 400 with one is not; exactly five hops are allowed', async () => {
    const d = tmp();
    const run = (f: typeof fetch, to: string) =>
      systemExecutor(noChild, { fetch: f }).run({
        kind: 'download',
        url: REL,
        to: join(d, to),
        sha256: sha(BLOB),
        bytes: BLOB.length,
      });
    await expect(run(fakeFetch({ [REL]: { status: 302 } }), 'a')).rejects.toThrow(/answered 302$/);
    const notFollowed = fakeFetch({ [REL]: { status: 200, body: BLOB, location: ASSET } });
    await run(notFollowed, 'b');
    expect(notFollowed.seen.map((s) => s.url)).toEqual([REL]);
    await expect(run(fakeFetch({ [REL]: { status: 400, location: ASSET } }), 'c')).rejects.toThrow(
      /answered 400$/,
    );
    const three00 = fakeFetch({
      [REL]: { status: 300, location: ASSET },
      [ASSET]: { status: 200, body: BLOB },
    });
    await run(three00, 'd');
    expect(three00.seen.map((s) => s.url)).toEqual([REL, ASSET]);
    // five redirects in all, then the file
    const hop = (i: number) => `https://github.com/r/${i}`;
    const table: Record<string, { status: number; body?: Buffer; location?: string }> = {
      [REL]: { status: 302, location: hop(1) },
      [hop(1)]: { status: 302, location: hop(2) },
      [hop(2)]: { status: 302, location: hop(3) },
      [hop(3)]: { status: 302, location: hop(4) },
      [hop(4)]: { status: 302, location: hop(5) },
      [hop(5)]: { status: 200, body: BLOB },
    };
    await run(fakeFetch(table), 'e');
    expect(readFileSync(join(d, 'e')).equals(BLOB)).toBe(true);
  });
  it('a 200 with no body is refused', async () => {
    const d = tmp();
    await expect(
      systemExecutor(noChild, { fetch: fakeFetch({ [REL]: { status: 200 } }) }).run({
        kind: 'download',
        url: REL,
        to: join(d, 'x'),
        sha256: sha(BLOB),
        bytes: 1,
      }),
    ).rejects.toThrow(/answered 200$/);
  });
  it('an entry is absolute only when it starts with a drive or a slash; the message names it', () => {
    expect(entryProblem('a/C:b')).toBeNull();
    expect(entryProblem('C:\\evil')).toBe('C:\\evil is an absolute path');
    expect(entryProblem('/etc/x')).toBe('/etc/x is an absolute path');
  });
  it('a failed run names the last line of the child’s stderr', async () => {
    const r: Runner = async () => ({ code: 3, stdout: '', stderr: 'first\nsecond\nthe last line\n' });
    await expect(systemExecutor(r).run(runAction(['x'], '/', { describe: 'the step' }))).rejects.toThrow(
      /^the step exited with 3: the last line$/,
    );
  });
  it('an archive whose listing fails is refused with nothing unpacked', async () => {
    const d = tmp();
    writeFileSync(join(d, 'c.tar'), 'x');
    const r: Runner = async () => ({ code: 2, stdout: '', stderr: 'bad' });
    await expect(
      systemExecutor(r).run({
        kind: 'unpack',
        archive: join(d, 'c.tar'),
        sha256: sha('x'),
        to: join(d, 'out'),
      }),
    ).rejects.toThrow(`listing ${join(d, 'c.tar')} exited with 2; nothing unpacked`);
    expect(readdirSync(d)).toEqual(['c.tar']);
  });
  it('every step that is not a run resolves an empty stdout', async () => {
    const d = tmp();
    expect(await systemExecutor(noChild).run({ kind: 'mkdir', path: join(d, 'x'), mode: 0o700 })).toEqual({
      stdout: '',
    });
  });
  it('a health answer that is JSON but not an object is no answer: it keeps waiting until the deadline', async () => {
    let clock = 0;
    const answers = ['true', '"ok"', 'null'];
    const f: typeof fetch = async () => new Response(answers.shift() ?? 'null', { status: 200 });
    const e = systemExecutor(noChild, {
      fetch: f,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });
    await expect(
      e.run({ kind: 'waitHealthy', url: 'http://127.0.0.1:1/api/health', timeoutSeconds: 4 }),
    ).rejects.toThrow('did not answer healthy within 4 s');
  });
  it('a copy whose source cannot be read leaves no temporary file beside the target', async () => {
    const d = tmp();
    mkdirSync(join(d, 'src-dir'));
    await expect(
      systemExecutor(noChild).run({
        kind: 'copy',
        from: join(d, 'src-dir'),
        to: join(d, 'dst.db'),
        mode: 0o600,
      }),
    ).rejects.toThrow();
    expect(readdirSync(d)).toEqual(['src-dir']);
  });
  // why: the executor joins POSIX paths (the CLI refuses Windows before it runs), so this compares POSIX paths only
  it.skipIf(process.platform === 'win32')('a tar is extracted with -C into the fresh directory', async () => {
    const d = tmp();
    const calls: Array<readonly string[]> = [];
    const r: Runner = async (argv) => {
      calls.push(argv);
      if (argv[1] === '-tf') return { code: 0, stdout: 'f\n', stderr: '' };
      writeFileSync(join(String(argv[4]), 'f'), 'x');
      return { code: 0, stdout: '', stderr: '' };
    };
    writeFileSync(join(d, 'a.tar'), 't');
    await systemExecutor(r).run({
      kind: 'unpack',
      archive: join(d, 'a.tar'),
      sha256: sha('t'),
      to: join(d, 'out'),
    });
    expect(calls[1]?.slice(0, 4)).toEqual(['tar', '-xf', join(d, 'a.tar'), '-C']);
    expect(String(calls[1]?.[4]).startsWith(join(d, '.out.tmp-'))).toBe(true);
  });
  it('a health answer that is not 2xx is no answer, whatever its body says', async () => {
    let clock = 0;
    const f: typeof fetch = async () => new Response('{"ok":true}', { status: 503 });
    const e = systemExecutor(noChild, {
      fetch: f,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });
    await expect(
      e.run({ kind: 'waitHealthy', url: 'http://127.0.0.1:1/api/health', timeoutSeconds: 2 }),
    ).rejects.toThrow('within 2 s');
  });
});

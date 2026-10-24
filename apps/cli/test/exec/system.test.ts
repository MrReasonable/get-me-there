import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Runner } from '../../src/exec/runner.js';
import { systemRunner } from '../../src/exec/runner.js';
import { systemExecutor } from '../../src/exec/system.js';
import { runAction } from '../../src/plan/action.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'gmt-sysexec-'));
  dirs.push(d);
  return d;
};
const mode = (p: string) => statSync(p).mode & 0o777;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

let server: Server;
let base = '';
let health: Array<{ status: number; body: string }> = [];
const BLOB = Buffer.from('a'.repeat(200_000));
beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/blob') {
      res.writeHead(200, { 'content-length': String(BLOB.length) });
      res.end(BLOB);
    } else if (req.url === '/api/health') {
      const h = health.length > 1 ? health.shift() : health[0];
      res.writeHead(h?.status ?? 503, { 'content-type': 'application/json' });
      res.end(h?.body ?? '{}');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(() => {
  server.close();
});

describe.skipIf(process.platform === 'win32')(
  'systemExecutor (temporary directory; POSIX modes)',
  { timeout: 30_000 },
  () => {
    const ex = systemExecutor(systemRunner, { sleep: async () => {} });

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
      // replacing an existing 0644 file still leaves 0600
      writeFileSync(join(d, 'old.env'), 'x', { mode: 0o644 });
      await ex.run({ kind: 'writeFile', path: join(d, 'old.env'), contents: 'y', mode: 0o600, secret: true });
      expect([readFileSync(join(d, 'old.env'), 'utf8'), mode(join(d, 'old.env'))]).toEqual(['y', 0o600]);
    });

    it('a write that fails leaves no temporary file and the old file intact', async () => {
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
      ).rejects.toThrow();
      expect(readdirSync(d)).toEqual(['f']);
    });

    it('mkdir applies its mode whatever the umask, and is idempotent', async () => {
      const d = tmp();
      const old = process.umask(0o077);
      try {
        await ex.run({ kind: 'mkdir', path: join(d, 'a', 'b'), mode: 0o755 });
        await ex.run({ kind: 'mkdir', path: join(d, 'a', 'b'), mode: 0o700 });
      } finally {
        process.umask(old);
      }
      expect(mode(join(d, 'a', 'b'))).toBe(0o700);
    });

    it('copy writes through a temporary file and renames, with its mode', async () => {
      const d = tmp();
      writeFileSync(join(d, 'src.db'), 'database bytes', { mode: 0o644 });
      await ex.run({ kind: 'copy', from: join(d, 'src.db'), to: join(d, 'dst.db'), mode: 0o600 });
      expect([readFileSync(join(d, 'dst.db'), 'utf8'), mode(join(d, 'dst.db'))]).toEqual([
        'database bytes',
        0o600,
      ]);
      expect(readdirSync(d).sort()).toEqual(['dst.db', 'src.db']);
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

    it('run uses execFile with the argv, never a shell, and passes the input on stdin only', async () => {
      const d = tmp();
      const calls: Array<{ argv: readonly string[]; stdin: string | undefined }> = [];
      const spy: Runner = (argv, opts) => {
        calls.push({ argv, stdin: opts.stdin });
        return systemRunner(argv, opts);
      };
      const e = systemExecutor(spy, { sleep: async () => {} });
      await e.run(
        runAction(
          [
            process.execPath,
            '-e',
            'require("fs").writeFileSync("out", require("fs").readFileSync(0)); console.log(process.argv[1])',
            '$HOME;x',
          ],
          d,
          {
            stdin: 'SECRET-on-stdin',
            secretStdin: true,
          },
        ),
      );
      expect(readFileSync(join(d, 'out'), 'utf8')).toBe('SECRET-on-stdin');
      expect(calls[0]?.argv.join(' ')).not.toContain('SECRET');
      expect(calls[0]?.stdin).toBe('SECRET-on-stdin');
      expect(existsSync(join(d, 'x'))).toBe(false);
    });

    it('a failing run throws naming its describe and exit; a secret-input run never shows its stderr', async () => {
      const d = tmp();
      await expect(
        ex.run(
          runAction([process.execPath, '-e', 'console.error("boom line"); process.exit(3)'], d, {
            describe: 'the step',
          }),
        ),
      ).rejects.toThrow('the step exited with 3: boom line');
      const err = await ex
        .run(
          runAction(
            [
              process.execPath,
              '-e',
              'process.stdin.pipe(process.stderr); process.stdin.on("end", () => process.exit(4))',
            ],
            d,
            {
              describe: 'secret step',
              stdin: 'SENTINEL-in-err',
              secretStdin: true,
            },
          ),
        )
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(String(err)).toContain('secret step exited with 4');
      expect(String(err)).not.toContain('SENTINEL');
    });

    it('download streams while hashing, then moves the file into place', async () => {
      const d = tmp();
      await ex.run({
        kind: 'download',
        url: `${base}/blob`,
        to: join(d, 'blob'),
        sha256: sha(BLOB),
        bytes: BLOB.length,
      });
      expect(readFileSync(join(d, 'blob')).equals(BLOB)).toBe(true);
      expect(readdirSync(d)).toEqual(['blob']);
    });
    it('a hash or size mismatch deletes the partial file and refuses', async () => {
      const d = tmp();
      await expect(
        ex.run({
          kind: 'download',
          url: `${base}/blob`,
          to: join(d, 'blob'),
          sha256: sha('other'),
          bytes: BLOB.length,
        }),
      ).rejects.toThrow('sha256');
      await expect(
        ex.run({ kind: 'download', url: `${base}/blob`, to: join(d, 'blob'), sha256: sha(BLOB), bytes: 1 }),
      ).rejects.toThrow('bytes');
      await expect(
        ex.run({ kind: 'download', url: `${base}/none`, to: join(d, 'blob'), sha256: sha(BLOB), bytes: 1 }),
      ).rejects.toThrow('404');
      expect(readdirSync(d)).toEqual([]);
    });

    it('unpack refuses an archive whose sha256 differs, unpacking nothing', async () => {
      const d = tmp();
      writeFileSync(join(d, 'a.zip'), 'not really');
      await expect(
        ex.run({ kind: 'unpack', archive: join(d, 'a.zip'), sha256: sha('x'), to: join(d, 'out') }),
      ).rejects.toThrow('sha256');
      expect(existsSync(join(d, 'out'))).toBe(false);
    });

    it('waitHealthy polls until /api/health answers ok, and fails at its deadline', async () => {
      health = [
        { status: 503, body: '{}' },
        { status: 200, body: '{"ok":false,"degraded":false}' },
        { status: 200, body: '{"ok":true,"degraded":false}' },
      ];
      let slept = 0;
      const e = systemExecutor(systemRunner, {
        sleep: async () => {
          slept++;
        },
      });
      await e.run({ kind: 'waitHealthy', url: `${base}/api/health`, timeoutSeconds: 30 });
      expect(slept).toBe(2);
      health = [{ status: 503, body: '{}' }];
      let clock = 0;
      const late = systemExecutor(systemRunner, {
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
      });
      await expect(
        late.run({ kind: 'waitHealthy', url: `${base}/api/health`, timeoutSeconds: 10 }),
      ).rejects.toThrow('did not answer healthy within 10 s');
    });

    it('run passes stdin only when the action has one, and the default or given timeout', async () => {
      const seen: Array<Record<string, unknown>> = [];
      const spy: Runner = async (_argv, opts) => {
        seen.push({ ...opts });
        return { code: 0, stdout: '', stderr: '' };
      };
      await systemExecutor(spy).run(runAction(['x'], '/'));
      await systemExecutor(spy, { runTimeoutMs: 5 }).run(runAction(['x'], '/', { stdin: '' }));
      expect(seen).toEqual([
        { cwd: '/', timeoutMs: 30 * 60_000 },
        { cwd: '/', timeoutMs: 5, stdin: '' },
      ]);
    });

    it('a failure shows only the last line of stderr, and nothing after the code when stderr is empty', async () => {
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
        systemExecutor(fail('the secret\n')).run(
          runAction(['x'], '/', { describe: 'step', stdin: 's', secretStdin: true }),
        ),
      ).rejects.toThrow(/^step exited with 2$/);
    });

    it('a write whose temporary file was never made reports the write’s own error', async () => {
      const d = tmp();
      await expect(
        ex.run({
          kind: 'writeFile',
          path: join(d, 'missing', 'f'),
          contents: 'x',
          mode: 0o600,
          secret: true,
        }),
      ).rejects.toMatchObject({ syscall: 'open', code: 'ENOENT' });
    });

    it('a downloaded file is 0600, and a non-2xx answer is refused by its status', async () => {
      const d = tmp();
      await ex.run({
        kind: 'download',
        url: `${base}/blob`,
        to: join(d, 'blob'),
        sha256: sha(BLOB),
        bytes: BLOB.length,
      });
      expect(mode(join(d, 'blob'))).toBe(0o600);
      await expect(
        ex.run({ kind: 'download', url: `${base}/none`, to: join(d, 'x'), sha256: sha(BLOB), bytes: 0 }),
      ).rejects.toThrow(/answered 404$/);
    });

    it('unpack checks the hash, unpacks a tar or a zip with the right argv into a fresh directory and moves it into place', async () => {
      const d = tmp();
      mkdirSync(join(d, 'src', 'inner'), { recursive: true });
      writeFileSync(join(d, 'src', 'inner', 'f.txt'), 'packed');
      const calls: Array<{ argv: readonly string[]; cwd: string }> = [];
      const spy: Runner = (argv, opts) => {
        calls.push({ argv, cwd: opts.cwd });
        return systemRunner(argv, opts);
      };
      const e = systemExecutor(spy);
      const tar = join(d, 'a.tar');
      await systemRunner(['tar', '-cf', tar, '-C', join(d, 'src'), 'inner'], { cwd: d, timeoutMs: 30_000 });
      mkdirSync(join(d, 'out.unpacking'));
      writeFileSync(join(d, 'out.unpacking', 'stale'), 'old');
      await e.run({ kind: 'unpack', archive: tar, sha256: sha(readFileSync(tar)), to: join(d, 'out') });
      expect(readFileSync(join(d, 'out', 'inner', 'f.txt'), 'utf8')).toBe('packed');
      expect(existsSync(join(d, 'out', 'stale'))).toBe(false);
      expect(existsSync(join(d, 'out.unpacking'))).toBe(false);
      expect(calls.at(-1)).toEqual({ argv: ['tar', '-xf', tar, '-C', join(d, 'out.unpacking')], cwd: d });
      const zip = join(d, 'b.zip');
      if (
        (await systemRunner(['zip', '-qr', zip, 'inner'], { cwd: join(d, 'src'), timeoutMs: 30_000 }))
          .code === 0
      ) {
        await e.run({ kind: 'unpack', archive: zip, sha256: sha(readFileSync(zip)), to: join(d, 'zout') });
        expect(readFileSync(join(d, 'zout', 'inner', 'f.txt'), 'utf8')).toBe('packed');
        expect(calls.at(-1)?.argv).toEqual(['unzip', '-q', zip, '-d', join(d, 'zout.unpacking')]);
      }
      const bad = join(d, 'c.tar');
      writeFileSync(bad, 'not a tar at all');
      await expect(
        e.run({ kind: 'unpack', archive: bad, sha256: sha('not a tar at all'), to: join(d, 'cout') }),
      ).rejects.toThrow(`unpacking ${bad} exited with`);
      expect(existsSync(join(d, 'cout.unpacking'))).toBe(false);
      expect(existsSync(join(d, 'cout'))).toBe(false);
    });

    it('waitHealthy sleeps 2 s between tries until its deadline, inclusive; by default with a real clock and pause', async () => {
      health = [{ status: 503, body: '{}' }];
      let clock = 0;
      const sleeps: number[] = [];
      const e = systemExecutor(systemRunner, {
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += ms;
        },
        now: () => clock,
      });
      await expect(
        e.run({ kind: 'waitHealthy', url: `${base}/api/health`, timeoutSeconds: 10 }),
      ).rejects.toThrow();
      expect(sleeps).toEqual([2000, 2000, 2000, 2000, 2000]);
      await expect(
        systemExecutor(systemRunner).run({
          kind: 'waitHealthy',
          url: `${base}/api/health`,
          timeoutSeconds: 0,
        }),
      ).rejects.toThrow('within 0 s');
      health = [
        { status: 503, body: '{}' },
        { status: 200, body: '{"ok":true}' },
      ];
      const started = Date.now();
      await systemExecutor(systemRunner).run({
        kind: 'waitHealthy',
        url: `${base}/api/health`,
        timeoutSeconds: 30,
      });
      expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
    });
  },
);

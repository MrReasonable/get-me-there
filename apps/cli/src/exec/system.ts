import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path/posix';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Action, Executor } from '../plan/action.js';
import type { Runner } from './runner.js';

/**
 * The real executor (decision 72; brief Task 16b.10). Every file lands through a sibling temporary file and a rename,
 * with its mode set explicitly (whatever the umask); a `run` goes through the one `Runner` (execFile, never a shell),
 * its input on stdin only; a download is hashed while it streams and removed on a mismatch. Errors name the action,
 * never a secret: a run with secret input never shows the child's stderr.
 */
export interface SystemExecutorOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** How long a `run` may take before it is stopped. */
  runTimeoutMs?: number;
}

const tempBeside = (path: string): string =>
  join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);

async function landed(path: string, mode: number, write: (tmp: string) => Promise<void>): Promise<void> {
  const tmp = tempBeside(path);
  try {
    await write(tmp);
    await chmod(tmp, mode);
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

async function sha256Of(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}

export function systemExecutor(runner: Runner, opts: SystemExecutorOptions = {}): Executor {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const runTimeoutMs = opts.runTimeoutMs ?? 30 * 60_000;
  return {
    async run(a: Action): Promise<void> {
      switch (a.kind) {
        case 'mkdir':
          await mkdir(a.path, { recursive: true, mode: a.mode });
          await chmod(a.path, a.mode);
          return;
        case 'writeFile':
          await landed(a.path, a.mode, (tmp) => writeFile(tmp, a.contents, { mode: a.mode, flag: 'wx' }));
          return;
        case 'copy':
          await landed(a.to, a.mode, (tmp) => copyFile(a.from, tmp));
          return;
        case 'rename':
          await rename(a.from, a.to);
          return;
        case 'remove':
          await rm(a.path, { recursive: a.recursive, force: true });
          return;
        case 'run': {
          const r = await runner(a.argv, {
            cwd: a.cwd,
            timeoutMs: runTimeoutMs,
            ...(a.stdin === undefined ? {} : { stdin: a.stdin }),
          });
          if (r.code === 0) return;
          const last = a.secretStdin ? '' : (r.stderr.trim().split('\n').at(-1) ?? '');
          throw new Error(`${a.describe} exited with ${r.code}${last === '' ? '' : `: ${last}`}`);
        }
        case 'download': {
          const res = await fetch(a.url, { redirect: 'follow' });
          if (!res.ok || res.body === null) throw new Error(`download of ${a.url} answered ${res.status}`);
          const part = `${a.to}.part`;
          const hash = createHash('sha256');
          let bytes = 0;
          try {
            const counted = Readable.fromWeb(res.body).on('data', (c: Buffer) => {
              hash.update(c);
              bytes += c.length;
            });
            await pipeline(counted, createWriteStream(part, { mode: 0o600 }));
            const got = hash.digest('hex');
            if (bytes !== a.bytes)
              throw new Error(`download of ${a.url}: ${bytes} bytes, expected ${a.bytes}; removed`);
            if (got !== a.sha256)
              throw new Error(`download of ${a.url}: sha256 ${got} is not the pinned ${a.sha256}; removed`);
            await rename(part, a.to);
          } catch (e) {
            await unlink(part).catch(() => {});
            throw e;
          }
          return;
        }
        case 'unpack': {
          const got = await sha256Of(a.archive);
          if (got !== a.sha256)
            throw new Error(`${a.archive}: sha256 ${got} is not the pinned ${a.sha256}; nothing unpacked`);
          const tmp = `${a.to}.unpacking`;
          await rm(tmp, { recursive: true, force: true });
          await mkdir(tmp, { recursive: true, mode: 0o755 });
          const argv = a.archive.endsWith('.zip')
            ? ['unzip', '-q', a.archive, '-d', tmp]
            : ['tar', '-xf', a.archive, '-C', tmp];
          const r = await runner(argv, { cwd: dirname(a.archive), timeoutMs: runTimeoutMs });
          if (r.code !== 0) {
            await rm(tmp, { recursive: true, force: true });
            throw new Error(`unpacking ${a.archive} exited with ${r.code}`);
          }
          await rename(tmp, a.to);
          return;
        }
        case 'waitHealthy': {
          const deadline = now() + a.timeoutSeconds * 1000;
          for (;;) {
            try {
              const res = await fetch(a.url, { signal: AbortSignal.timeout(5000) });
              const body: unknown = res.ok ? await res.json() : null;
              if (typeof body === 'object' && body !== null && 'ok' in body && body.ok === true) return;
            } catch {
              // not up yet
            }
            if (now() >= deadline)
              throw new Error(`${a.url} did not answer healthy within ${a.timeoutSeconds} s`);
            await sleep(2000);
          }
        }
      }
    },
  };
}

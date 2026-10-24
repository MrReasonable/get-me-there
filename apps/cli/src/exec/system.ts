import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path/posix';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { REDIRECT_HOSTS } from '@gmt/core';
import type { Action, Executor } from '../plan/action.js';
import type { Runner } from './runner.js';

/**
 * The real executor (decision 72; brief Task 16b.10). Every file lands through a sibling temporary file that is created
 * exclusively at its target mode before any data is written, then renamed (U8: never wider than the target, never
 * through a planted path). A `run` goes through the one `Runner` (execFile, never a shell), its input on stdin only, and
 * resolves the child's stdout. A download is https only, every redirect hop on decision 73's hosts, hashed and size
 * capped while it streams; an archive's entries are checked before it is unpacked into a 0700 directory beside the
 * target. Errors name the action, never a secret: a run with secret input never shows the child's stderr.
 */
export interface SystemExecutorOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** How long a `run` may take before it is stopped. */
  runTimeoutMs?: number;
  /** The fetch a download and the health wait use (tests pass their own). */
  fetch?: typeof fetch;
  /** How long one health request may take before it counts as no answer. */
  healthTryMs?: number;
}

const tempBeside = (path: string): string =>
  join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);

/** Creates `tmp` exclusively at `mode`, lets `fill` write it, then sets the exact mode and renames it over `path`. */
async function landed(path: string, mode: number, fill: (tmp: string) => Promise<void>): Promise<void> {
  const tmp = tempBeside(path);
  let created = false;
  try {
    // why: U8 (sec-b1-003, ts-b1-015): the file exists at its final mode (or narrower, under the umask) from its first byte
    await (await open(tmp, 'wx', mode)).close();
    created = true;
    await fill(tmp);
    await chmod(tmp, mode);
    await rename(tmp, path);
  } catch (e) {
    if (created) await rm(tmp, { force: true });
    throw e;
  }
}

async function sha256Of(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}

const MAX_REDIRECTS = 5;

/** The response for a download URL, following redirects by hand: https only, and every hop on decision 73's hosts. */
async function fetchPinned(fetchFn: typeof fetch, url: string): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(current);
    if (u.protocol !== 'https:') throw new Error(`download of ${url}: ${current} is not https; refused`);
    if (!REDIRECT_HOSTS.some((h) => h === u.hostname))
      throw new Error(`download of ${url}: ${u.hostname} is not a release host; refused`);
    const res = await fetchFn(current, { redirect: 'manual' });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location !== null) {
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok || res.body === null) throw new Error(`download of ${url} answered ${res.status}`);
    return res;
  }
  throw new Error(`download of ${url}: more than ${MAX_REDIRECTS} redirects; refused`);
}

/** Why an archive entry may not be unpacked (absolute, `..`, or escaping its directory), or null. */
export function entryProblem(entry: string): string | null {
  if (entry === '') return null;
  if (isAbsolute(entry) || /^[A-Za-z]:/.test(entry)) return `${entry} is an absolute path`;
  const n = normalize(entry);
  if (n === '..' || n.startsWith('../') || entry.split('/').includes('..'))
    return `${entry} leaves the archive's directory`;
  return null;
}

export function systemExecutor(runner: Runner, opts: SystemExecutorOptions = {}): Executor {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const runTimeoutMs = opts.runTimeoutMs ?? 30 * 60_000;
  const fetchFn = opts.fetch ?? fetch;
  const healthTryMs = opts.healthTryMs ?? 5000;
  const none = { stdout: '' };
  return {
    async run(a: Action): Promise<{ stdout: string }> {
      switch (a.kind) {
        case 'mkdir':
          // why: U8 (sec-b1-001): an existing directory is tightened to the mode too
          await mkdir(a.path, { recursive: true, mode: a.mode });
          await chmod(a.path, a.mode);
          return none;
        case 'writeFile':
          await landed(a.path, a.mode, async (tmp) => {
            const h = await open(tmp, 'w');
            try {
              await h.writeFile(a.contents);
            } finally {
              await h.close();
            }
          });
          return none;
        case 'copy':
          await landed(a.to, a.mode, (tmp) =>
            pipeline(createReadStream(a.from), createWriteStream(tmp, { flags: 'w' })),
          );
          return none;
        case 'rename':
          await rename(a.from, a.to);
          return none;
        case 'remove':
          await rm(a.path, { recursive: a.recursive, force: true });
          return none;
        case 'run': {
          const r = await runner(a.argv, {
            cwd: a.cwd,
            timeoutMs: runTimeoutMs,
            ...(a.stdin === undefined ? {} : { stdin: a.stdin.text }),
            ...(a.env === undefined ? {} : { env: a.env }),
          });
          if (r.code === 0) return { stdout: r.stdout };
          const last = a.stdin?.secret === true ? '' : (r.stderr.trim().split('\n').at(-1) ?? '');
          throw new Error(`${a.describe} exited with ${r.code}${last === '' ? '' : `: ${last}`}`);
        }
        case 'download': {
          const res = await fetchPinned(fetchFn, a.url);
          const part = `${a.to}.part`;
          await rm(part, { force: true });
          const hash = createHash('sha256');
          let bytes = 0;
          const capped = new Transform({
            transform(chunk: Buffer, _enc, done) {
              bytes += chunk.length;
              if (bytes > a.bytes)
                return done(new Error(`download of ${a.url}: more than ${a.bytes} bytes; removed`));
              hash.update(chunk);
              done(null, chunk);
            },
          });
          try {
            if (res.body === null) throw new Error(`download of ${a.url} has no body`);
            await pipeline(
              Readable.fromWeb(res.body),
              capped,
              createWriteStream(part, { flags: 'wx', mode: 0o600 }),
            );
            const got = hash.digest('hex');
            if (bytes !== a.bytes)
              throw new Error(`download of ${a.url}: ${bytes} bytes, expected ${a.bytes}; removed`);
            if (got !== a.sha256)
              throw new Error(`download of ${a.url}: sha256 ${got} is not the pinned ${a.sha256}; removed`);
            await rename(part, a.to);
          } catch (e) {
            await rm(part, { force: true });
            throw e;
          }
          return none;
        }
        case 'unpack': {
          const got = await sha256Of(a.archive);
          if (got !== a.sha256)
            throw new Error(`${a.archive}: sha256 ${got} is not the pinned ${a.sha256}; nothing unpacked`);
          const zip = a.archive.endsWith('.zip');
          const listed = await runner(zip ? ['unzip', '-Z1', a.archive] : ['tar', '-tf', a.archive], {
            cwd: dirname(a.archive),
            timeoutMs: runTimeoutMs,
          });
          if (listed.code !== 0)
            throw new Error(`listing ${a.archive} exited with ${listed.code}; nothing unpacked`);
          const bad = listed.stdout
            .split('\n')
            .map((e) => entryProblem(e.trim()))
            .find((p) => p !== null);
          if (bad !== undefined) throw new Error(`${a.archive}: ${bad}; nothing unpacked`);
          await mkdir(dirname(a.to), { recursive: true });
          const tmp = tempBeside(a.to);
          await mkdir(tmp, { mode: 0o700 });
          try {
            const argv = zip ? ['unzip', '-q', a.archive, '-d', tmp] : ['tar', '-xf', a.archive, '-C', tmp];
            const r = await runner(argv, { cwd: dirname(a.archive), timeoutMs: runTimeoutMs });
            if (r.code !== 0) throw new Error(`unpacking ${a.archive} exited with ${r.code}`);
            await rename(tmp, a.to);
          } catch (e) {
            await rm(tmp, { recursive: true, force: true });
            throw e;
          }
          return none;
        }
        case 'waitGone': {
          const deadline = now() + a.timeoutSeconds * 1000;
          for (;;) {
            if ((await runner(a.argv, { cwd: '/', timeoutMs: 15_000 })).code !== 0) return none;
            if (now() >= deadline) throw new Error(`${a.describe} still answers after ${a.timeoutSeconds} s`);
            await sleep(1000);
          }
        }
        case 'waitHealthy': {
          const deadline = now() + a.timeoutSeconds * 1000;
          for (;;) {
            if (await healthy(fetchFn, a.url, healthTryMs)) return none;
            if (now() >= deadline)
              throw new Error(`${a.url} did not answer healthy within ${a.timeoutSeconds} s`);
            await sleep(2000);
          }
        }
      }
    },
  };
}

/** One health try: a 2xx JSON answer with `ok: true` within `tryMs`. */
async function healthy(fetchFn: typeof fetch, url: string, tryMs: number): Promise<boolean> {
  let res: Response;
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(tryMs) });
  } catch {
    return false;
  }
  if (!res.ok) return false;
  const body: unknown = await res.json().catch(() => null);
  return typeof body === 'object' && body !== null && 'ok' in body && body.ok === true;
}

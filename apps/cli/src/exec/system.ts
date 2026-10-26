import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, open, readdir, readFile, readlink, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path/posix';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { REDIRECT_HOSTS } from '@gmt/core';
import type { Action, Executor } from '../plan/action.js';
import { answeredAsWorker, notAnswering, workerAnswerUrl } from '../worker/answer.js';
import { liveHolder, stillHeld } from '../worker/lock.js';
import { refusalOfText } from '../worker/refusal.js';
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
  /** How long one health request, or one request to the worker, may take before it counts as no answer. */
  healthTryMs?: number;
  /**
   * Called with each temporary file once it exists and before any data is written to it (a test's event to check its
   * mode at that moment, since no poll can catch it reliably); production passes none.
   */
  onTemporary?: (tmp: string) => Promise<void>;
  /** How long a download may wait for the answer's headers, or for its next bytes (sec-b1-002); 60 s by default. */
  downloadIdleMs?: number;
  /** How long a whole download may take; 60 minutes by default. */
  downloadTotalMs?: number;
  /**
   * The download bounds' timers and each worker request's own bound (tests pass their own to fire a bound on demand);
   * the real ones by default.
   */
  timers?: { set(fire: () => void, ms: number): unknown; clear(handle: unknown): void };
  /** Whether a pid is a live process, for `waitUnlocked` (tests pass their own); `pidAlive` by default. */
  isAlive?: (pid: number) => boolean;
}

/** process.kill(pid, 0): true while the process exists (EPERM: it exists under another user), as the worker's lock. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e instanceof Error && 'code' in e && e.code === 'EPERM';
  }
}

/** A file's text, or null when it does not exist; any other read error is thrown. */
async function textOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return null;
    throw e;
  }
}

const tempBeside = (path: string): string =>
  join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);

/** The real timers behind the download bounds: each handle a number of its own, so a test's timers can be any value. */
function realDownloadTimers(): NonNullable<SystemExecutorOptions['timers']> {
  let next = 0;
  const live = new Map<number, ReturnType<typeof setTimeout>>();
  return {
    set(fire, ms) {
      const id = ++next;
      live.set(
        id,
        setTimeout(() => {
          live.delete(id);
          fire();
        }, ms),
      );
      return id;
    },
    clear(h) {
      if (typeof h !== 'number') return;
      clearTimeout(live.get(h));
      live.delete(h);
    },
  };
}

/** Creates `tmp` exclusively at `mode`, lets `fill` write it, then sets the exact mode and renames it over `path`. */
async function landed(
  path: string,
  mode: number,
  fill: (tmp: string) => Promise<void>,
  onTemporary: (tmp: string) => Promise<void>,
): Promise<void> {
  const tmp = tempBeside(path);
  let created = false;
  try {
    // why: U8 (sec-b1-003, ts-b1-015): the file exists at its final mode (or narrower, under the umask) from its first byte
    await (await open(tmp, 'wx', mode)).close();
    created = true;
    await onTemporary(tmp);
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

/**
 * The response for a download URL, following redirects by hand: https only, and every hop on decision 73's hosts. A
 * redirect's own body is cancelled before the next hop (sec-b1-002), and `signal` bounds every hop.
 */
async function fetchPinned(fetchFn: typeof fetch, url: string, signal: AbortSignal): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(current);
    if (u.protocol !== 'https:') throw new Error(`download of ${url}: ${current} is not https; refused`);
    if (!REDIRECT_HOSTS.some((h) => h === u.hostname))
      throw new Error(`download of ${url}: ${u.hostname} is not a release host; refused`);
    const res = await fetchFn(current, { redirect: 'manual', signal });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location !== null) {
      await res.body?.cancel();
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok || res.body === null) {
      await res.body?.cancel();
      throw new Error(`download of ${url} answered ${res.status}`);
    }
    return res;
  }
  throw new Error(`download of ${url}: more than ${MAX_REDIRECTS} redirects; refused`);
}

/**
 * The symlinks under an unpacked tree whose targets are absolute or lead out of it (sec-b1-003), as `link -> target`.
 * The pinned digest already fixes the archive's content; this is the second line. unzip and tar create an archive's
 * symlinks after its files, so no entry was written through one.
 */
async function escapingLinks(root: string): Promise<string[]> {
  const out: string[] = [];
  // why: a walk of its own, which never follows a link (a recursive readdir may)
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) await walk(path);
      else if (e.isSymbolicLink()) {
        const target = await readlink(path);
        const rel = relative(root, resolve(dirname(path), target));
        if (isAbsolute(target) || rel === '..' || rel.startsWith('../'))
          out.push(`${relative(root, path)} -> ${target}`);
      }
    }
  };
  await walk(root);
  return out;
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
  const onTemporary = opts.onTemporary ?? (async () => {});
  const idleMs = opts.downloadIdleMs ?? 60_000;
  const totalMs = opts.downloadTotalMs ?? 60 * 60_000;
  const timers = opts.timers ?? realDownloadTimers();
  const isAlive = opts.isAlive ?? pidAlive;
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
          await landed(
            a.path,
            a.mode,
            async (tmp) => {
              const h = await open(tmp, 'w');
              try {
                await h.writeFile(a.contents);
              } finally {
                await h.close();
              }
            },
            onTemporary,
          );
          return none;
        case 'copy': {
          // why: a missing source fails here, before any temporary file exists; the destination is written through a
          // handle already open, so no stream is still opening when a failure's clean-up removes the temporary file
          await (await open(a.from, 'r')).close();
          await landed(
            a.to,
            a.mode,
            async (tmp) => {
              const dst = await open(tmp, 'w');
              await pipeline(createReadStream(a.from), dst.createWriteStream());
            },
            onTemporary,
          );
          return none;
        }
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
          // why: sec-b1-002: a stalled connection fails within the idle bound, and the whole download within its own
          const stop = new AbortController();
          const stall = () => stop.abort(new Error(`download of ${a.url}: no data for ${idleMs / 1000} s`));
          let idle = timers.set(stall, idleMs);
          const total = timers.set(
            () => stop.abort(new Error(`download of ${a.url}: not done within ${totalMs / 60_000} minutes`)),
            totalMs,
          );
          const part = `${a.to}.part`;
          try {
            const res = await fetchPinned(fetchFn, a.url, stop.signal);
            await rm(part, { force: true });
            const hash = createHash('sha256');
            let bytes = 0;
            const capped = new Transform({
              transform(chunk: Buffer, _enc, done) {
                timers.clear(idle);
                idle = timers.set(stall, idleMs);
                bytes += chunk.length;
                if (bytes > a.bytes)
                  return done(new Error(`download of ${a.url}: more than ${a.bytes} bytes; removed`));
                hash.update(chunk);
                done(null, chunk);
              },
            });
            if (res.body === null) throw new Error(`download of ${a.url} has no body`);
            await pipeline(
              Readable.fromWeb(res.body),
              capped,
              createWriteStream(part, { flags: 'wx', mode: 0o600 }),
              { signal: stop.signal },
            );
            const got = hash.digest('hex');
            if (bytes !== a.bytes)
              throw new Error(`download of ${a.url}: ${bytes} bytes, expected ${a.bytes}; removed`);
            if (got !== a.sha256)
              throw new Error(`download of ${a.url}: sha256 ${got} is not the pinned ${a.sha256}; removed`);
            await rename(part, a.to);
          } catch (e) {
            await rm(part, { force: true });
            throw stop.signal.aborted && stop.signal.reason instanceof Error ? stop.signal.reason : e;
          } finally {
            timers.clear(idle);
            timers.clear(total);
          }
          return none;
        }
        case 'unpack': {
          const got = await sha256Of(a.archive);
          if (got !== a.sha256) {
            // why: W6: an archive kept for a retry (or restored from CI's cache) that no longer hashes is never reused
            await rm(a.archive, { force: true });
            throw new Error(
              `${a.archive}: sha256 ${got} is not the pinned ${a.sha256}; removed, nothing unpacked`,
            );
          }
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
            const links = await escapingLinks(tmp);
            if (links.length > 0)
              throw new Error(
                `${a.archive}: a link leads out of the bundle (${links.join(', ')}); nothing kept`,
              );
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
        // why: systemd's `stop` itself blocks until its stop job ends (the event); this probe confirms it, a second apart
        case 'waitState': {
          const deadline = now() + a.timeoutSeconds * 1000;
          for (;;) {
            const r = await runner(a.argv, { cwd: '/', timeoutMs: 15_000 });
            const word = r.stdout.trim();
            if (r.code === 0 && a.until.includes(word)) return none;
            if (now() >= deadline)
              throw new Error(
                `${a.describe} still prints ${word === '' ? 'nothing' : word} after ${a.timeoutSeconds} s`,
              );
            await sleep(1000);
          }
        }
        // why: no event marks another process's exit (it is not our child, and a killed holder leaves its file behind),
        // so the lock is read a second apart on this executor's clock until no live process holds it
        case 'waitUnlocked': {
          const deadline = now() + a.timeoutSeconds * 1000;
          for (;;) {
            const pid = liveHolder(await textOrNull(a.path), isAlive);
            if (pid === null) return none;
            if (now() >= deadline) throw new Error(stillHeld(a, pid));
            await sleep(1000);
          }
        }
        // why: spec §13: the worker's service manager returns before the worker listens; it is asked a second apart on
        // this executor's clock, each try ended by its own bound on this executor's timers
        case 'waitWorkerAnswers': {
          const deadline = now() + a.timeoutSeconds * 1000;
          for (;;) {
            if (await workerAnswers(fetchFn, a.port, healthTryMs, timers)) return none;
            if (now() >= deadline) {
              let refusal: ReturnType<typeof refusalOfText>;
              try {
                refusal = refusalOfText(await textOrNull(a.refusalFile));
              } catch {
                refusal = 'unreadable';
              }
              throw new Error(notAnswering(a, refusal));
            }
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

/** One request to the worker on loopback (worker/answer.ts): an answer with its header within `tryMs`, never a redirect. */
async function workerAnswers(
  fetchFn: typeof fetch,
  port: number,
  tryMs: number,
  timers: NonNullable<SystemExecutorOptions['timers']>,
): Promise<boolean> {
  const stop = new AbortController();
  const bound = timers.set(() => stop.abort(), tryMs);
  try {
    // why: a refused connection, or a try its bound ended, is no answer
    const res = await fetchFn(workerAnswerUrl(port), { redirect: 'manual', signal: stop.signal }).catch(
      () => null,
    );
    if (res === null) return false;
    await res.body?.cancel();
    return answeredAsWorker(res.headers);
  } finally {
    timers.clear(bound);
  }
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

// The logic of scripts/ensure-build.mjs, with its file-system, process and clock operations injectable for tests.
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { constants as osConstants, tmpdir } from 'node:os';
import { join } from 'node:path';

export const PACKAGES = ['packages/core', 'packages/db', 'packages/providers', 'packages/engine', 'apps/api'];
const STALE_LOCK_MS = 15 * 60_000;
export const WAIT_MS = 10 * 60_000;
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

// The lock protocol (CodeRabbit batch 3). why: a bare lock directory recorded no owner, so a build killed by Ctrl-C
// left a lock every later run waited 10 minutes on; two waiters could both clear one stale lock and build at once; and
// a holder's cleanup could delete its successor's lock.
// - The lock is a file holding its owner's record, { pid, token }, created whole and exclusively (written to a
//   private temporary file, then hard-linked into place, which fails if the lock exists).
// - A lock is stale when its owner's pid no longer runs (taken over at once) or, as a backstop for a reused pid or a
//   lock without a record, when it is older than STALE_LOCK_MS.
// - Removing a lock, by a waiter taking a stale one over or by its owner releasing it, first claims
//   `<lock>.break-<key>` exclusively, where key names the exact record inspected (its token). Only the claimant may
//   remove that record, and it re-reads the lock and removes it only if the record is still the one inspected; any
//   later record has a different key. So two waiters never both take one stale lock, and an owner never removes a
//   successor's lock.
// - ensure-build.mjs releases on exit, on failure and on SIGINT, SIGTERM and SIGHUP; a SIGKILL leaves a lock whose
//   pid is dead, which the next run takes over at once.

/**
 * The lock for one checkout. why: keyed by checkout, so the main checkout and a worktree never wait on each other; a
 * hash of the whole path, since the old key (the path's last 12 bytes) was the same for every checkout named
 * get-me-there (CodeRabbit batch 3).
 */
export function lockPathFor(repo, dir = tmpdir()) {
  return join(dir, `gmt-build-${createHash('sha256').update(repo).digest('hex').slice(0, 24)}.lock`);
}

/** A lock file's record, or null when it holds none we can trust (an older directory lock, a torn or foreign file). */
function parseRecord(text) {
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    return null;
  }
  if (r === null || typeof r !== 'object') return null;
  if (!Number.isSafeInteger(r.pid) || r.pid <= 0) return null;
  if (typeof r.token !== 'string' || !/^[\w-]{1,64}$/.test(r.token)) return null;
  return { pid: r.pid, token: r.token };
}

/**
 * What the lock holds now: the key naming this exact record, its owner pid (null if unknown) and its mtime, all from
 * one open descriptor. why: PR #3 review — two path lookups (stat, then read) could pair a new owner's token with the
 * replaced lock's mtime, so a waiter judged a live lock stale by age and removed it. `afterStat` runs between the
 * metadata and the content read, where tests interleave a takeover.
 */
export function readLock(lock, afterStat = () => undefined) {
  let fd;
  try {
    fd = openSync(lock, 'r');
  } catch (err) {
    // why: an older directory lock opens on Linux but not everywhere; it has no record, so stat it as unowned
    if (err.code !== 'EISDIR') throw err;
    const st = lstatSync(lock);
    return { key: `unowned-${st.ino}-${Math.trunc(st.mtimeMs)}`, pid: null, mtimeMs: st.mtimeMs };
  }
  try {
    const st = fstatSync(fd);
    afterStat();
    let rec = null;
    if (st.isFile()) {
      try {
        rec = parseRecord(readFileSync(fd, 'utf8'));
      } catch {
        // a record that cannot be read is no record: the lock is then stale only by age
      }
    }
    // why: a lock without a record (missing pid metadata) is keyed by its inode and mtime, so a claim on it never
    // matches a lock created later
    if (rec === null)
      return { key: `unowned-${st.ino}-${Math.trunc(st.mtimeMs)}`, pid: null, mtimeMs: st.mtimeMs };
    return { key: rec.token, pid: rec.pid, mtimeMs: st.mtimeMs };
  } finally {
    closeSync(fd);
  }
}

export const realOps = {
  /** Creates the lock holding the record, whole and exclusively; throws EEXIST when it exists. */
  create: (lock, owned) => {
    const tmp = `${lock}.${owned.token}.tmp`;
    writeFileSync(tmp, JSON.stringify({ pid: owned.pid, token: owned.token }), { flag: 'wx' });
    try {
      linkSync(tmp, lock);
    } finally {
      rmSync(tmp, { force: true });
    }
  },
  /** What the lock holds now: the key naming this exact record, its owner pid (null if unknown) and its mtime. */
  read: (lock) => readLock(lock),
  /** True while a process with this pid exists (EPERM: it exists under another user). */
  alive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return err.code === 'EPERM';
    }
  },
  /** Takes an exclusive claim; false when another process holds it. */
  claim: (path) => {
    try {
      writeFileSync(path, String(process.pid), { flag: 'wx' });
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') return false;
      throw err;
    }
  },
  remove: (path) => rmSync(path, { recursive: true, force: true }),
  sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  now: () => Date.now(),
  token: () => randomUUID(),
  pid: process.pid,
};

/**
 * Removes the lock only if it still holds the record inspected (its key and, when given, the mtime read with it from
 * the same descriptor), under the exclusive claim for that key.
 * @returns {'removed' | 'gone' | 'changed' | 'claimed'} claimed: another process holds the claim for this record
 */
function removeIfStill(lock, key, mtimeMs, ops) {
  const claim = `${lock}.break-${key}`;
  if (!ops.claim(claim)) return 'claimed';
  try {
    let now;
    try {
      now = ops.read(lock);
    } catch (err) {
      if (err.code === 'ENOENT') return 'gone';
      throw err;
    }
    if (now.key !== key || (mtimeMs !== null && now.mtimeMs !== mtimeMs)) return 'changed';
    ops.remove(lock);
    return 'removed';
  } finally {
    ops.remove(claim);
  }
}

/** Takes over the stale lock whose record was inspected as `seen`; false when the lock is no longer that record. */
export function breakStale(lock, seen, ops = realOps) {
  const r = removeIfStill(lock, seen.key, seen.mtimeMs ?? null, ops);
  return r === 'removed' || r === 'gone';
}

/** Releases the lock if this owner still holds it; true when it removed it. */
export function release(lock, owned, ops = realOps) {
  return removeIfStill(lock, owned.token, null, ops) === 'removed';
}

/** Takes the cross-process lock, waiting for a live holder and taking over a stale one. Returns the owner record. */
export function acquire(lock, ops = realOps) {
  const owned = { pid: ops.pid, token: ops.token() };
  const until = ops.now() + WAIT_MS;
  for (;;) {
    try {
      ops.create(lock, owned);
      return owned;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    let seen;
    try {
      seen = ops.read(lock);
    } catch (err) {
      // why: re-review N1 — the holder can release between our failed create and this read; the lock is free, retry.
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    const ownerGone = seen.pid !== null && !ops.alive(seen.pid);
    if ((ownerGone || ops.now() - seen.mtimeMs > STALE_LOCK_MS) && breakStale(lock, seen, ops)) continue;
    if (ops.now() > until)
      throw new Error(`ensure-build: gave up waiting for ${lock}, held by pid ${seen.pid ?? 'unknown'}`);
    ops.sleep(250);
  }
}

/** Releases the lock and exits when the process is interrupted. Returns a function that removes the handlers. */
export function releaseOnSignal(lock, owned, proc = process, ops = realOps) {
  const handlers = SIGNALS.map((sig) => {
    const onSignal = () => {
      release(lock, owned, ops);
      proc.exit(128 + osConstants.signals[sig]);
    };
    proc.on(sig, onSignal);
    return [sig, onSignal];
  });
  return () => {
    for (const [sig, onSignal] of handlers) proc.off(sig, onSignal);
  };
}

/** Newest mtime among the build inputs: each package's src, tsconfigs and package.json, and the root's config. */
export function newestInput(repo) {
  let newest = 0;
  const touch = (p) => {
    newest = Math.max(newest, statSync(p).mtimeMs);
  };
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else touch(join(dir, e.name));
    }
  };
  for (const pkg of PACKAGES) {
    const root = join(repo, pkg);
    if (existsSync(join(root, 'src'))) walk(join(root, 'src'));
    for (const f of readdirSync(root)) if (/^(tsconfig.*\.json|package\.json)$/.test(f)) touch(join(root, f));
  }
  // why: re-review N2 — root config (shared tsconfig base, dependency versions) changes the build as well.
  for (const f of readdirSync(repo))
    if (/^(tsconfig.*\.json|package\.json|pnpm-lock\.yaml)$/.test(f)) touch(join(repo, f));
  return newest;
}

/** True unless every package is built and the stamp is at least as new as every input. */
export function needsBuild(repo, stamp) {
  if (!PACKAGES.every((p) => existsSync(join(repo, p, 'dist')))) return true;
  return !existsSync(stamp) || statSync(stamp).mtimeMs < newestInput(repo);
}

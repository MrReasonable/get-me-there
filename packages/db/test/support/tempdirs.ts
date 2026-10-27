// Temporary directories for tests, and the guard that keeps them from piling up. This file is listed in the package's
// `setupFiles`, so every test file gets it. The same file lives in each package that makes temporary directories
// (scripts/check-temp-dirs.mjs fails when the copies differ), because Stryker runs a package from a sandbox copy where
// a shared path outside the package would not resolve.
//
// - `tempDir(prefix)` is removed after the test that made it; `fileTempDir(prefix)` after the whole file (a `beforeAll`
//   fixture, or a directory made while the file loads).
// - While a file's tests run, `os.tmpdir()` points at a private directory of its own. Anything a test or the code under
//   test makes there and does not remove is reported when the file ends (and removed), so a leak fails the run instead of
//   filling the operator's temp directory. Because the directory is private, it never confuses a concurrent run.
import { spawn } from 'node:child_process';
import { chmodSync, lstatSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach } from 'vitest';

const perTest: string[] = [];
const perFile: string[] = [];

/** Env names `os.tmpdir()` reads on this platform. */
const TMP_ENV = process.platform === 'win32' ? ['TEMP', 'TMP'] : ['TMPDIR'];
/** Caches that Node and tsx create in the temp directory of any child process they run; they are not the tests'. */
const TOOL_CACHES = /^(node-compile-cache|tsx-\d+)$/;
let sandbox: string | undefined;
/** The janitor's stdin, held for the life of the process: the pipe closing is the janitor's signal. */
const heldPipes: unknown[] = [];

/**
 * A detached shell that removes `dir` once the pipe from this process closes. why: Stryker and `--bail` kill a test
 * worker mid-file, before any afterAll runs, and a killed process cannot clean up after itself; the operating system
 * closes the pipe whatever killed it, so the janitor needs no polling and no signal handler here.
 */
function startJanitor(dir: string): void {
  if (process.platform === 'win32') return;
  const child = spawn(
    'sh',
    ['-c', 'cat >/dev/null; chmod -R u+rwx "$1" 2>/dev/null; rm -rf "$1"', 'sh', dir],
    {
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
    },
  );
  child.on('error', () => undefined); // why: no shell to run it: the afterAll still removes the directory
  child.unref();
  child.stdin.on('error', () => undefined);
  // why: the pipe must not keep a finished worker alive; it is a net.Socket, which the Writable type does not say
  if ('unref' in child.stdin && typeof child.stdin.unref === 'function') child.stdin.unref();
  heldPipes.push(child.stdin);
}

// why: made while the setup file loads, before the test file does, so a directory made while the file is collected (a
// describe body, a module-level constant) is already inside it. A file whose tests are all skipped runs no hook, so the
// janitor (and, where there is none, the exit handler) removes the directory when the worker ends.
{
  // why: realpath, so a symlinked temp root (macOS /var -> /private/var) compares equal to what tests resolve
  const made = mkdtempSync(join(realpathSync(tmpdir()), 'gmt-run-'));
  for (const name of TMP_ENV) {
    process.env[name] = made;
  }
  sandbox = made;
  startJanitor(made);
  process.once('exit', () => rmSync(made, { recursive: true, force: true }));
}

/** Makes `p` and everything under it writable and traversable, without following symlinks out of the tree. */
function makeWritable(p: string): void {
  const st = lstatSync(p, { throwIfNoEntry: false });
  if (st === undefined || st.isSymbolicLink() || !st.isDirectory()) return;
  chmodSync(p, 0o700); // why: a test may have made it read-only or unreadable
  for (const name of readdirSync(p)) makeWritable(join(p, name));
}

/** Removes `p`, restoring permissions first if the plain removal is refused. Symlinks are unlinked, never followed. */
export function removeTree(p: string): void {
  try {
    rmSync(p, { recursive: true, force: true });
  } catch {
    makeWritable(p);
    rmSync(p, { recursive: true, force: true });
  }
}

/** A fresh directory under the OS temp dir, removed after the test. */
export function tempDir(prefix = 'gmt-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  perTest.push(dir);
  return dir;
}

/** A fresh directory under the OS temp dir, removed after the last test of the file. */
export function fileTempDir(prefix = 'gmt-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  perFile.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of perTest.splice(0)) removeTree(dir);
});

afterAll(() => {
  for (const dir of perFile.splice(0)) removeTree(dir);
  const made = sandbox;
  if (made === undefined) return;
  sandbox = undefined;
  // why: the temp-directory variable is left pointing at the removed directory, not restored: when a run is aborted
  // (`--bail`) this hook runs while a test is still going, and its late mkdtemp must fail rather than leak into the
  // operator's real temp directory
  const left = readdirSync(made).filter((name) => !TOOL_CACHES.test(name));
  removeTree(made);
  if (left.length > 0)
    throw new Error(
      `temporary entries left behind (removed now; remove them in the test): ${left.join(', ')}`,
    );
});

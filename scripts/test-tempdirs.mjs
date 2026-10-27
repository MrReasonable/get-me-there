// Temporary directories for the root scripts' tests, and the guard that keeps them from piling up. Listed in the
// `scripts` project's `setupFiles` (vitest.config.ts), so every scripts test file gets it. It does what the packages'
// test/support/tempdirs.ts does (scripts/check-temp-dirs.mjs holds the two to the same rules); this copy is plain
// JavaScript because the scripts are.
//
// - `tempDir(prefix)` is removed after the test that made it; `fileTempDir(prefix)` after the whole file.
// - While a file's tests run, `os.tmpdir()` points at a private directory of its own; anything left there is reported
//   when the file ends (and removed), so a leak fails the run. Because the directory is private, it never confuses a
//   concurrent run.
import { spawn } from 'node:child_process';
import { chmodSync, lstatSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach } from 'vitest';

/** @type {string[]} */
const perTest = [];
/** @type {string[]} */
const perFile = [];

const TMP_ENV = process.platform === 'win32' ? ['TEMP', 'TMP'] : ['TMPDIR'];
/** Caches that Node and tsx create in the temp directory of any child process they run; they are not the tests'. */
const TOOL_CACHES = /^(node-compile-cache|tsx-\d+)$/;
/** @type {string | undefined} */
let sandbox;
/**
 * The janitor's stdin, held for the life of the process: the pipe closing is the janitor's signal.
 * @type {unknown[]}
 */
const heldPipes = [];

/**
 * A detached shell that removes `dir` once the pipe from this process closes. why: `--bail` and Stryker kill a test
 * worker mid-file, before any afterAll runs, and a killed process cannot clean up after itself; the operating system
 * closes the pipe whatever killed it, so the janitor needs no polling and no signal handler here.
 * @param {string} dir
 */
function startJanitor(dir) {
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
  // why: the pipe must not keep a finished worker alive
  child.stdin.unref();
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

/**
 * Makes `p` and everything under it writable and traversable, without following symlinks out of the tree.
 * @param {string} p
 */
function makeWritable(p) {
  const st = lstatSync(p, { throwIfNoEntry: false });
  if (st === undefined || st.isSymbolicLink() || !st.isDirectory()) return;
  chmodSync(p, 0o700); // why: a test may have made it read-only or unreadable
  for (const name of readdirSync(p)) makeWritable(join(p, name));
}

/**
 * Removes `p`, restoring permissions first if the plain removal is refused. Symlinks are unlinked, never followed.
 * @param {string} p
 */
export function removeTree(p) {
  try {
    rmSync(p, { recursive: true, force: true });
  } catch {
    makeWritable(p);
    rmSync(p, { recursive: true, force: true });
  }
}

/**
 * A fresh directory under the OS temp dir, removed after the test.
 * @param {string} [prefix]
 */
export function tempDir(prefix = 'gmt-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  perTest.push(dir);
  return dir;
}

/**
 * A fresh directory under the OS temp dir, removed after the last test of the file.
 * @param {string} [prefix]
 */
export function fileTempDir(prefix = 'gmt-') {
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

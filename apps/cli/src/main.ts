// The `gmt` command's entry point (`pnpm gmt <command>`, decision 72): the only module of @gmt/cli that reads the
// process environment. It gathers the process facts once and hands them to the commands, which never read it.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { terminalAsk } from './ask.js';
import { runCli } from './cli.js';
import type { Deps, Http } from './deps.js';
import { systemFiles } from './exec/files.js';
import { systemRunner } from './exec/runner.js';
import { systemExecutor } from './exec/system.js';
import { currentPlatform } from './platform/current.js';

const env: Readonly<Record<string, string | undefined>> = { ...process.env };
// why: apps/cli/src/main.ts is three directories below the checkout's root, wherever pnpm was run from
const checkout = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Requests to this machine's app only; the Authorization header is never logged or echoed. */
const http: Http = async (r) => {
  try {
    const res = await fetch(r.url, {
      method: r.method,
      headers: r.headers,
      ...(r.body === undefined ? {} : { body: r.body }),
      signal: AbortSignal.timeout(r.timeoutMs),
    });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    return { error: e instanceof Error ? e.name : 'request failed' };
  }
};

const portFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });

const attach = (argv: readonly string[], cwd: string): Promise<number> =>
  new Promise((resolve) => {
    const [file, ...args] = argv;
    if (file === undefined) return resolve(127);
    const child = spawn(file, args, { cwd, stdio: 'inherit' });
    child.on('error', () => resolve(127));
    child.on('exit', (code) => resolve(code ?? 1));
  });

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<number> {
  let platform: Deps['platform'];
  try {
    platform = currentPlatform({
      platform: process.platform,
      arch: process.arch,
      uid: process.getuid?.() ?? -1,
      env,
    });
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 78;
  }
  const deps: Deps = {
    platform,
    files: systemFiles,
    run: systemRunner,
    executor: systemExecutor(systemRunner),
    ask: terminalAsk({ input: process.stdin, output: process.stdout }),
    io: {
      out: (t) => process.stdout.write(t),
      err: (t) => process.stderr.write(t),
      stdoutIsTTY: process.stdout.isTTY === true,
      stdinIsTTY: process.stdin.isTTY === true,
      readStdin,
    },
    http,
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    checkout,
    execPath: process.execPath,
    nodeVersion: process.versions.node,
    username: userInfo().username,
    env,
    machineTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tmpDir: tmpdir(),
    portFree,
    randomBytes,
    attach,
  };
  return runCli(process.argv.slice(2), deps);
}

process.exitCode = await main();

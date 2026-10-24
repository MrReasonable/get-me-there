import { dirname } from 'node:path';
import type { Deps } from '../deps.js';

/** One unmet prerequisite: what is wrong and the one-line fix for this OS (null when there is no command for it). */
export interface Problem {
  check: string;
  message: string;
  fix: string | null;
}

/** Everything the prerequisite checks read (spec §13), gathered before any action. */
export interface PrereqFacts {
  os: 'darwin' | 'linux';
  uid: number;
  nodeVersion: string;
  nodeDir: string;
  nodeDirWritable: boolean;
  pnpm: boolean;
  corepack: boolean;
  git: boolean;
  /** The port the plan will bind, checked only when setup is choosing one; null otherwise. */
  port: { wanted: number; free: boolean; nextFree: number | null } | null;
  /** The user service manager: usable, macOS with no GUI session, Linux with no user bus, or no systemd at all. */
  manager: 'ok' | 'no-gui' | 'no-bus' | 'no-systemd';
  journalPersistent: boolean;
}

export const MIN_NODE = [22, 18] as const;

/** Whether a `x.y.z` version is at least 22.18. */
export function nodeAtLeast(version: string, min: readonly [number, number] = MIN_NODE): boolean {
  const [maj = 0, minor = 0] = version.split('.').map((n) => Number.parseInt(n, 10));
  return maj > min[0] || (maj === min[0] && minor >= min[1]);
}

/** The next port above `from` that `portFree` accepts, trying 20; null when none is. */
export async function nextFreePort(
  from: number,
  portFree: (p: number) => Promise<boolean>,
): Promise<number | null> {
  for (let p = from + 1; p <= Math.min(65535, from + 20); p++) if (await portFree(p)) return p;
  return null;
}

/** Reads the facts; every read goes through the runner or Files, and none changes anything. */
export async function gatherPrereqs(deps: Deps, port: number | null): Promise<PrereqFacts> {
  const os = deps.platform.os === 'linux' ? 'linux' : 'darwin';
  const ok = async (argv: string[]) =>
    (await deps.run(argv, { cwd: deps.checkout, timeoutMs: 20_000 })).code === 0;
  const pnpm = await ok(['pnpm', '--version']);
  const corepack = await ok(['corepack', '--version']);
  const git = await ok(['git', '--version']);
  let manager: PrereqFacts['manager'] = 'ok';
  if (os === 'darwin') {
    if (!(await ok(['launchctl', 'print', `gui/${deps.platform.uid}`]))) manager = 'no-gui';
  } else {
    const r = await deps.run(['systemctl', '--user', 'show-environment'], { cwd: '/', timeoutMs: 20_000 });
    // why: `is-system-running` exits non-zero for `degraded`, so the probe is show-environment (brief §7)
    if (r.code !== 0)
      manager = r.code === 127 || !deps.files.isDir('/run/systemd/system') ? 'no-systemd' : 'no-bus';
  }
  let portFact: PrereqFacts['port'] = null;
  if (port !== null) {
    const free = await deps.portFree(port);
    portFact = { wanted: port, free, nextFree: free ? null : await nextFreePort(port, deps.portFree) };
  }
  const nodeDir = dirname(deps.execPath);
  return {
    os,
    uid: deps.platform.uid,
    nodeVersion: deps.nodeVersion,
    nodeDir,
    nodeDirWritable: deps.files.writable(nodeDir),
    pnpm,
    corepack,
    git,
    port: portFact,
    manager,
    journalPersistent: os === 'darwin' || deps.files.isDir('/var/log/journal'),
  };
}

/** The checks, pure: every problem with its fix, and the notes that are not failures. */
export function judgePrereqs(f: PrereqFacts): { problems: Problem[]; notes: string[] } {
  const problems: Problem[] = [];
  const notes: string[] = [];
  if (!nodeAtLeast(f.nodeVersion))
    problems.push({
      check: 'node',
      message: `Node ${f.nodeVersion} is older than ${MIN_NODE.join('.')}`,
      fix:
        f.os === 'darwin'
          ? 'brew install node@22'
          : 'install Node 22 from the distribution’s nodejs package or NodeSource’s package (https://github.com/nodesource/distributions)',
    });
  if (!f.pnpm)
    problems.push(
      f.corepack
        ? {
            check: 'pnpm',
            message: 'pnpm is not on PATH',
            fix: f.nodeDirWritable
              ? 'corepack enable'
              : 'corepack enable --install-directory ~/.local/bin (then add ~/.local/bin to PATH)',
          }
        : {
            check: 'pnpm',
            message: 'pnpm is not on PATH and corepack is missing',
            fix: 'npm install --global corepack, then corepack enable',
          },
    );
  if (!f.git)
    problems.push({
      check: 'git',
      message: 'git is not installed',
      fix: f.os === 'darwin' ? 'xcode-select --install' : 'install the distribution’s git package',
    });
  if (f.port !== null && !f.port.free)
    problems.push({
      check: 'port',
      message: `port ${f.port.wanted} is in use on 127.0.0.1`,
      fix:
        f.port.nextFree === null ? 'choose another port' : `choose ${f.port.nextFree} (the next free port)`,
    });
  if (f.manager === 'no-gui')
    problems.push({
      check: 'service-manager',
      message: 'no GUI session (for example over SSH)',
      fix: 'log in at the Mac, or turn on automatic login for a Mac that must run unattended',
    });
  else if (f.manager === 'no-bus')
    problems.push({
      check: 'service-manager',
      message: 'the systemd user manager does not answer (no user bus)',
      fix: `log in through a proper session, or set XDG_RUNTIME_DIR=/run/user/${f.uid}`,
    });
  else if (f.manager === 'no-systemd')
    problems.push({
      check: 'service-manager',
      message: 'this setup needs systemd',
      fix: 'use the container path (docs/setup.md section 1)',
    });
  if (!f.journalPersistent)
    notes.push(
      'the journal is not persistent, so the app’s logs go at a reboot; to keep them: sudo mkdir -p /var/log/journal && sudo systemctl restart systemd-journald',
    );
  return { problems, notes };
}

/** Problems as the lines setup prints before it stops. */
export function describeProblems(problems: readonly Problem[]): string {
  return `${problems.map((p) => `setup cannot continue: ${p.message}${p.fix === null ? '' : `\n  fix: ${p.fix}`}`).join('\n')}\n`;
}

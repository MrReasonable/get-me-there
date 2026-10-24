// why: the memory machine's paths are POSIX on every host (Windows' join would write backslashes)
import { join } from 'node:path/posix';
import type { Deps } from '../../src/deps.js';
import { MemoryFs, type RunHandler } from '../../src/exec/memory.js';
import { type scriptedAsk, stubHttp, type TestIo, testIo, testWorld } from './deps.js';

/**
 * A stand-in machine for whole-command tests: launchd's or systemd's state follows the commands run (bootstrap and
 * bootout load and unload; enable --now, start and stop change state), the backup job writes a backup file, Docker
 * is absent, and every other command succeeds. `fail` makes a matching argv fail; `extra` answers first.
 */
export function machine(
  opts: {
    os?: 'darwin' | 'linux';
    fs?: MemoryFs;
    ask?: ReturnType<typeof scriptedAsk>;
    io?: TestIo;
    http?: ReturnType<typeof stubHttp>;
    fail?: (argv: readonly string[]) => boolean;
    extra?: RunHandler;
    deps?: Partial<Deps>;
    backupWrites?: boolean;
  } = {},
) {
  const os = opts.os ?? 'darwin';
  const fs = opts.fs ?? new MemoryFs(501);
  const home = os === 'darwin' ? '/Users/op' : '/home/op';
  const daily = join(home, '.local', 'share', 'get-me-there', 'backups', 'daily');
  fs.file('/repo/package.json', '{}')
    .dir('/opt/node/bin', 0o755)
    .file('/opt/node/bin/node', 'node binary', 0o755);
  const loaded = new Set<string>();
  const running = new Set<string>();
  let backups = 0;
  const writeBackup = () => {
    if (opts.backupWrites === false) return;
    backups++;
    fs.file(join(daily, `get-me-there-2026-10-24T09-30-0${backups}-000Z.db`), 'db', 0o600);
  };
  const handler: RunHandler = (argv, call) => {
    const extra = opts.extra?.(argv, call);
    if (extra !== undefined) return extra;
    if (opts.fail?.(argv) === true) return { code: 1, stderr: 'refused by the test' };
    const [cmd, a1, a2, a3] = argv;
    if (cmd === 'docker') return { code: 127 };
    // the daily job's own command run directly (gmt backup with the job booted out)
    if (argv.some((x) => x.endsWith('backup.mjs')) && argv.includes(daily)) {
      writeBackup();
      if (opts.backupWrites === false) return { code: 74, stderr: 'backup failed' };
      return {
        code: 0,
        stdout: `${JSON.stringify({ ok: true, file: join(daily, `get-me-there-2026-10-24T09-30-0${backups}-000Z.db`) })}\n`,
      };
    }
    if (cmd === 'pnpm' && a1 === 'build') {
      fs.file('/repo/apps/api/dist/bootstrap/start.js', '// built');
      return { code: 0 };
    }
    if (cmd === 'launchctl') {
      if (a1 === 'print') {
        if (a2 === 'gui/501') return { code: 0 };
        const label = (a2 ?? '').split('/')[2] ?? '';
        if (!loaded.has(label)) return { code: 113 };
        return {
          code: 0,
          stdout: running.has(label)
            ? '\tstate = running\n'
            : '\tstate = not running\n\tlast exit code = 0\n',
        };
      }
      if (a1 === 'bootstrap') {
        const label =
          (a3 ?? '')
            .split('/')
            .pop()
            ?.replace(/\.plist$/, '') ?? '';
        loaded.add(label);
        if (!label.endsWith('.backup')) running.add(label);
        return { code: 0 };
      }
      if (a1 === 'bootout') {
        const label = (a2 ?? '').split('/')[2] ?? '';
        loaded.delete(label);
        running.delete(label);
        return { code: 0 };
      }
      if (a1 === 'kickstart') {
        const target = argv.at(-1) ?? '';
        if (target.endsWith('.backup')) writeBackup();
        else running.add(target.split('/')[2] ?? '');
        return { code: 0 };
      }
    }
    if (cmd === 'systemctl') {
      if (a2 === 'show-environment') return { code: 0 };
      if (a2 === 'is-active') {
        const u = a3 ?? '';
        return running.has(u) ? { code: 0, stdout: 'active\n' } : { code: 3, stdout: 'inactive\n' };
      }
      const unit = argv.at(-1) ?? '';
      if (a2 === 'enable' || a2 === 'start' || a2 === 'restart') {
        if (unit === 'get-me-there-backup.service') writeBackup();
        else running.add(unit);
      }
      if (a2 === 'stop') running.delete(unit);
      return { code: 0 };
    }
    if (cmd === 'loginctl' && a1 === 'show-user') return { code: 0, stdout: 'no\n' };
    return undefined;
  };
  const w = testWorld({
    os,
    fs,
    run: handler,
    ...(opts.ask ? { ask: opts.ask } : {}),
    io: opts.io ?? testIo(),
    // why: U1: commands that restart the app ask it first; by default no run is active and it answers healthy
    http:
      opts.http ??
      stubHttp({
        'GET /api/executions/active': () => ({ status: 200, body: { execution: null } }),
        'GET /api/health': () => ({ status: 200, body: { ok: true, degraded: false } }),
      }),
    ...(opts.deps ? { deps: opts.deps } : {}),
  });
  if (os === 'linux') fs.dir('/run/systemd/system').dir('/var/log/journal');
  return { ...w, home, daily, loaded, running, backupCount: () => backups };
}

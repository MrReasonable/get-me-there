import { describe, expect, it } from 'vitest';
import { MemoryFs, memoryRunner } from '../../src/exec/memory.js';
import { runAction } from '../../src/plan/action.js';
import { describePlan, describeResult } from '../../src/plan/describe.js';
import { currentPlatform } from '../../src/platform/current.js';
import type { ServiceFacts } from '../../src/platform/types.js';
import { renderPlist } from '../../src/services/launchd.js';
import { appServiceSpec, backupServiceSpec, execPathProblem } from '../../src/services/specs.js';
import { renderTimer } from '../../src/services/systemd.js';

// The edges of the service managers and the plan text, one assertion a rule (the mutation run's survivors).
const mac = currentPlatform({ platform: 'darwin', arch: 'arm64', uid: 501, env: { HOME: '/Users/a' } });
const lin = currentPlatform({ platform: 'linux', arch: 'x64', uid: 1000, env: { HOME: '/home/a' } });
const input = (p: typeof mac) => ({ execPath: '/usr/bin/node', checkout: '/c', home: '/h', paths: p.paths });
const f = (x: Partial<ServiceFacts>): ServiceFacts => ({
  onDisk: null,
  loaded: false,
  state: 'not-installed',
  ...x,
});

describe('launchd edges', () => {
  const app = mac.serviceManager.render(appServiceSpec(input(mac)), mac.paths);
  const key = 'local.get-me-there.app';
  it('with no log directory the plist names no log path', () => {
    const t = renderPlist(appServiceSpec(input(mac)), { ...mac.paths, logs: null });
    expect(t).not.toContain('StandardOutPath');
    expect(t).not.toContain('StandardErrorPath');
  });
  it.each([
    ['\t\tstate = running', 'running'],
    ['\tstate = running  ', 'running'],
    ['\tjob state = running', 'stopped'],
    ['\tstate = running-ish', 'stopped'],
    ['\t\tlast exit code = 78: EX_CONFIG', 'failed'],
    ['\tprevious last exit code = 78', 'stopped'],
  ])('launchctl print %j is %s', async (printed, state) => {
    const fs = new MemoryFs().file(app[0]?.path ?? '', 'x');
    const run = memoryRunner(fs, (a) =>
      a[0] === 'launchctl' ? { code: 0, stdout: `${printed}\n` } : undefined,
    );
    expect((await mac.serviceManager.facts(app, run)).get(key)?.state).toBe(state);
  });
  it('facts reads with cwd / and a 15 s timeout; every action runs in /', async () => {
    const run = memoryRunner(new MemoryFs());
    await mac.serviceManager.facts(app, run);
    expect(run.calls.map((c) => [c.cwd, c.timeoutMs])).toEqual([
      ['/', 15_000],
      ['/', 15_000],
    ]);
    const acts = [
      ...mac.serviceManager.install(app, new Map()),
      ...mac.serviceManager.restart(key, f({ loaded: true, onDisk: 'x', state: 'running' })),
    ];
    for (const a of acts) if (a.kind === 'run') expect(a.cwd).toBe('/');
    const write = acts.find((a) => a.kind === 'writeFile');
    expect(write).toMatchObject({ secret: false, mode: 0o644 });
  });
  it('remove with no facts plans nothing; a removal is never recursive', () => {
    expect(mac.serviceManager.remove(app, new Map())).toEqual([]);
    expect(mac.serviceManager.remove(app, new Map([[key, f({ onDisk: 'x' })]]))).toEqual([
      { kind: 'remove', path: app[0]?.path, recursive: false },
    ]);
  });
});

describe('systemd edges', () => {
  const job = lin.serviceManager.render(backupServiceSpec(input(lin)), lin.paths);
  it('the timer file, whole, with a one-digit minute padded', () => {
    expect(renderTimer({ ...backupServiceSpec(input(lin)), calendar: { hour: 3, minute: 5 } })).toBe(
      '[Unit]\nDescription=get-me-there backup timer\n\n[Timer]\nOnCalendar=*-*-* 03:05:00\nPersistent=true\nUnit=get-me-there-backup.service\n\n[Install]\nWantedBy=timers.target\n',
    );
    expect(job[1]?.path).toBe('/home/a/.config/systemd/user/get-me-there-backup.timer');
  });
  it.each(['active', 'activating', 'reloading', 'deactivating', 'refreshing'])(
    'is-active %s is running',
    async (word) => {
      const run = memoryRunner(new MemoryFs(), (a) =>
        a[0] === 'systemctl' ? { code: 0, stdout: `${word}\n` } : undefined,
      );
      expect((await lin.serviceManager.facts(job, run)).get('get-me-there-backup.service')?.state).toBe(
        'running',
      );
    },
  );
  it('facts reads with cwd / and a 15 s timeout; actions run in /; written units are not secret', async () => {
    const run = memoryRunner(new MemoryFs());
    await lin.serviceManager.facts(job, run);
    for (const c of run.calls) expect([c.cwd, c.timeoutMs]).toEqual(['/', 15_000]);
    const acts = lin.serviceManager.install(job, new Map());
    for (const a of acts) {
      if (a.kind === 'run') expect(a.cwd).toBe('/');
      if (a.kind === 'writeFile') expect([a.secret, a.mode]).toEqual([false, 0o644]);
    }
  });
  it('remove: the timer first whatever the order, a loaded unit with no file is stopped but no file removed, never recursive', () => {
    const reversed = [job[1], job[0]].filter((r) => r !== undefined);
    const facts = new Map([
      ['get-me-there-backup.service', f({ onDisk: job[0]?.contents ?? '', state: 'stopped' })],
      ['get-me-there-backup.timer', f({ loaded: true, state: 'running' })],
    ]);
    const acts = lin.serviceManager.remove(reversed, facts);
    expect(
      acts.map((a) =>
        a.kind === 'run'
          ? a.argv.slice(2).join(' ')
          : `${a.kind} ${a.kind === 'remove' ? `${a.path} ${a.recursive}` : ''}`,
      ),
    ).toEqual([
      'stop get-me-there-backup.timer',
      'disable get-me-there-backup.timer',
      'stop get-me-there-backup.service',
      'remove /home/a/.config/systemd/user/get-me-there-backup.service false',
      'daemon-reload',
      'reset-failed',
    ]);
  });
});

describe('specs and the plan text', () => {
  it('a tmpDirs entry with or without a trailing slash covers only that directory', () => {
    for (const t of ['/x/T', '/x/T/']) {
      expect(execPathProblem('/x/T/n/node', 'darwin', [t])).toContain('a temporary directory');
      expect(execPathProblem('/x/Tother/n/node', 'darwin', [t])).toBeNull();
    }
  });
  it('a file’s lines are counted with or without a final newline', () => {
    const w = (contents: string) =>
      describePlan({
        command: 'c',
        actions: [{ kind: 'writeFile', path: '/f', contents, mode: 0o644, secret: false }],
        notes: [],
      });
    expect(w('a\nb')).toContain('(0644, 2 lines)');
    expect(w('a\nb\n')).toContain('(0644, 2 lines)');
  });
  it('the failure report, whole', () => {
    const a = runAction(['x'], '/');
    expect(describeResult('cmd', { done: [a], failed: { action: a, error: 'boom' }, notRun: [a] })).toBe(
      'cmd: stopped at a failed step; nothing was undone\n  done:    run x\n  failed:  run x: boom\n  not run: run x\n  run the same command again to carry on from here\n',
    );
  });
  it('a run with no input has no stdin key at all', () => {
    expect(Object.keys(runAction(['x'], '/'))).toEqual(['kind', 'argv', 'cwd', 'describe', 'secretStdin']);
  });
});

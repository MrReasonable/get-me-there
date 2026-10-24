import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MemoryFs, memoryRunner } from '../../src/exec/memory.js';
import { currentPlatform } from '../../src/platform/current.js';
import type { ServiceFacts } from '../../src/platform/types.js';
import { appServiceSpec, backupServiceSpec } from '../../src/services/specs.js';
import { tokeniseExecStart, unitLines } from './helpers.js';

const p = currentPlatform({ platform: 'linux', arch: 'x64', uid: 1000, env: { HOME: '/home/a' } });
const sm = p.serviceManager;
const input = { execPath: '/usr/bin/node', checkout: '/home/a/src/gmt', home: '/home/a', paths: p.paths };
const app = sm.render(appServiceSpec(input), p.paths);
const backup = sm.render(backupServiceSpec(input), p.paths);
const UNIT = '/home/a/.config/systemd/user/get-me-there-app.service';

describe('systemd rendering (spec §13; brief §7 systemd keys)', () => {
  it('the app unit snapshot', () => {
    expect(app.map((r) => [r.path, r.unitName])).toEqual([[UNIT, 'get-me-there-app.service']]);
    expect(app[0]?.contents).toMatchInlineSnapshot(`
      "[Unit]
      Description=get-me-there app

      [Service]
      Type=simple
      WorkingDirectory=/home/a/src/gmt
      ExecStart="/usr/bin/node" "--env-file=/home/a/.config/get-me-there/app.env" "/home/a/src/gmt/apps/api/dist/bootstrap/start.js"
      Environment="PATH=/usr/bin:/bin:/usr/sbin:/sbin" "HOME=/home/a"
      Restart=on-failure
      RestartSec=60
      TimeoutStopSec=30
      KillSignal=SIGTERM

      [Install]
      WantedBy=default.target
      "
    `);
  });

  it('the backup job is a oneshot .service plus a persistent .timer at 03:30', () => {
    expect(backup.map((r) => r.unitName)).toEqual([
      'get-me-there-backup.service',
      'get-me-there-backup.timer',
    ]);
    const [svc, timer] = backup.map((r) => r.contents);
    expect(unitLines(svc ?? '', 'Service')).toContain('Type=oneshot');
    expect(svc).not.toContain('Restart=');
    expect(svc).not.toContain('[Install]');
    expect(unitLines(timer ?? '', 'Timer')).toEqual([
      'OnCalendar=*-*-* 03:30:00',
      'Persistent=true',
      'Unit=get-me-there-backup.service',
    ]);
    expect(unitLines(timer ?? '', 'Install')).toEqual(['WantedBy=timers.target']);
    const exec =
      unitLines(svc ?? '', 'Service')
        .find((l) => l.startsWith('ExecStart='))
        ?.slice('ExecStart='.length) ?? '';
    expect(tokeniseExecStart(exec)).toEqual(backupServiceSpec(input).argv);
  });

  it('a worker spec gets RestartPreventExitStatus', () => {
    const t = sm.render(
      {
        ...appServiceSpec(input),
        name: 'camoufox-worker',
        preventRestartExitStatus: 78,
        throttleSeconds: 600,
      },
      p.paths,
    );
    expect(t[0]?.unitName).toBe('get-me-there-camoufox-worker.service');
    expect(unitLines(t[0]?.contents ?? '', 'Service')).toContain('RestartPreventExitStatus=78');
  });

  it('property: ExecStart tokenised back equals the argv for paths with spaces, quotes, % and $', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ unit: fc.constantFrom('a', ' ', '"', "'", '%', '$', '\\', '{', 'é') }), {
          maxLength: 4,
        }),
        (words) => {
          const argv = ['/u s/node', ...words];
          const r = sm.render({ ...appServiceSpec(input), argv, workingDirectory: '/w %d/x' }, p.paths);
          const lines = unitLines(r[0]?.contents ?? '', 'Service');
          const exec = lines.find((l) => l.startsWith('ExecStart='))?.slice('ExecStart='.length) ?? '';
          expect(tokeniseExecStart(exec)).toEqual(argv);
          expect(lines).toContain('WorkingDirectory=/w %%d/x');
        },
      ),
    );
  });

  it('Environment= is exactly PATH and HOME', () => {
    for (const r of [...app, backup[0]]) {
      const env = unitLines(r?.contents ?? '', 'Service').filter((l) => l.startsWith('Environment'));
      expect(env).toHaveLength(1);
      expect(
        tokeniseExecStart(env[0]?.slice('Environment='.length) ?? '').map((w) => w.split('=')[0]),
      ).toEqual(['PATH', 'HOME']);
    }
  });

  it('no rendered file names pnpm or corepack', () => {
    for (const r of [...app, ...backup]) expect(r.contents).not.toMatch(/pnpm|corepack/);
  });
});

const f = (x: Partial<ServiceFacts>): ServiceFacts => ({
  onDisk: null,
  loaded: false,
  state: 'not-installed',
  ...x,
});
const show = (as: { kind: string; argv?: readonly string[]; path?: string }[]) =>
  as.map((x) => (x.kind === 'run' ? (x.argv ?? []).join(' ') : `${x.kind} ${x.path ?? ''}`));

describe('systemd facts and planning', () => {
  it('facts reads each file and systemctl --user is-active once each', async () => {
    const fs = new MemoryFs().file(UNIT, 'old');
    const run = memoryRunner(fs, (argv) =>
      argv[0] === 'systemctl' ? { code: 0, stdout: 'active\n' } : undefined,
    );
    expect((await sm.facts(app, run)).get('get-me-there-app.service')).toEqual({
      onDisk: 'old',
      loaded: true,
      state: 'running',
    });
    expect(run.calls.map((c) => c.argv)).toEqual([
      ['cat', UNIT],
      ['systemctl', '--user', 'is-active', 'get-me-there-app.service'],
    ]);
  });

  it.each([
    ['activating', 0, true, 'old', 'running'],
    ['failed', 3, true, 'old', 'failed'],
    ['inactive', 3, false, 'old', 'stopped'],
    ['inactive', 3, false, null, 'not-installed'],
    ['unknown', 4, false, null, 'not-installed'],
  ] as const)('is-active %s (exit %d) gives loaded %s', async (stdout, code, loaded, onDisk, state) => {
    const fs = new MemoryFs();
    if (onDisk !== null) fs.file(UNIT, onDisk);
    const run = memoryRunner(fs, (argv) =>
      argv[0] === 'systemctl' ? { code, stdout: `${stdout}\n` } : undefined,
    );
    expect((await sm.facts(app, run)).get('get-me-there-app.service')).toEqual({ onDisk, loaded, state });
  });

  const contents = app[0]?.contents ?? '';
  it('an unchanged unit plans nothing', () => {
    expect(
      sm.install(
        app,
        new Map([['get-me-there-app.service', f({ onDisk: contents, loaded: true, state: 'running' })]]),
      ),
    ).toEqual([]);
  });
  it('a new unit: write, daemon-reload, enable --now', () => {
    expect(show(sm.install(app, new Map()))).toEqual([
      `writeFile ${UNIT}`,
      'systemctl --user daemon-reload',
      'systemctl --user enable --now get-me-there-app.service',
    ]);
  });
  it('a changed unit: write, daemon-reload, restart', () => {
    expect(
      show(
        sm.install(
          app,
          new Map([['get-me-there-app.service', f({ onDisk: 'old', loaded: true, state: 'running' })]]),
        ),
      ),
    ).toEqual([
      `writeFile ${UNIT}`,
      'systemctl --user daemon-reload',
      'systemctl --user restart get-me-there-app.service',
    ]);
  });
  it('a new job: both files, one daemon-reload, enable --now on the timer only', () => {
    expect(show(sm.install(backup, new Map()))).toEqual([
      'writeFile /home/a/.config/systemd/user/get-me-there-backup.service',
      'writeFile /home/a/.config/systemd/user/get-me-there-backup.timer',
      'systemctl --user daemon-reload',
      'systemctl --user enable --now get-me-there-backup.timer',
    ]);
  });
  it('a job whose service file changed: write it, daemon-reload, restart the timer (never run the job)', () => {
    const facts = new Map([
      ['get-me-there-backup.service', f({ onDisk: 'old', state: 'stopped' })],
      ['get-me-there-backup.timer', f({ onDisk: backup[1]?.contents ?? '', loaded: true, state: 'running' })],
    ]);
    expect(show(sm.install(backup, facts))).toEqual([
      'writeFile /home/a/.config/systemd/user/get-me-there-backup.service',
      'systemctl --user daemon-reload',
      'systemctl --user restart get-me-there-backup.timer',
    ]);
  });

  it('start, stop and restart by state', () => {
    const k = 'get-me-there-app.service';
    expect(show(sm.start(k, f({ onDisk: contents, state: 'stopped' })))).toEqual([
      `systemctl --user start ${k}`,
    ]);
    expect(show(sm.start(k, f({ onDisk: contents, loaded: true, state: 'running' })))).toEqual([]);
    expect(show(sm.start(k, f({})))).toEqual([]);
    expect(show(sm.stop(k, f({ onDisk: contents, loaded: true, state: 'running' })))).toEqual([
      `systemctl --user stop ${k}`,
    ]);
    expect(show(sm.stop(k, f({ onDisk: contents, loaded: true, state: 'failed' })))).toEqual([
      `systemctl --user stop ${k}`,
    ]);
    expect(show(sm.stop(k, f({ onDisk: contents, state: 'stopped' })))).toEqual([]);
    expect(show(sm.restart(k, f({ onDisk: contents, state: 'stopped' })))).toEqual([
      `systemctl --user restart ${k}`,
    ]);
    expect(show(sm.restart(k, f({})))).toEqual([]);
  });

  it('remove: stop, disable (units with an [Install]), delete, daemon-reload, reset-failed', () => {
    const facts = new Map([
      ['get-me-there-backup.service', f({ onDisk: backup[0]?.contents ?? '', state: 'stopped' })],
      ['get-me-there-backup.timer', f({ onDisk: backup[1]?.contents ?? '', loaded: true, state: 'running' })],
    ]);
    expect(show(sm.remove(backup, facts))).toEqual([
      'systemctl --user stop get-me-there-backup.timer',
      'systemctl --user disable get-me-there-backup.timer',
      'systemctl --user stop get-me-there-backup.service',
      'remove /home/a/.config/systemd/user/get-me-there-backup.service',
      'remove /home/a/.config/systemd/user/get-me-there-backup.timer',
      'systemctl --user daemon-reload',
      'systemctl --user reset-failed',
    ]);
    expect(sm.remove(backup, new Map())).toEqual([]);
  });
});

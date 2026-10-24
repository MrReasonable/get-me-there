import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MemoryFs, memoryRunner } from '../../src/exec/memory.js';
import { currentPlatform } from '../../src/platform/current.js';
import type { ServiceFacts, ServiceSpec } from '../../src/platform/types.js';
import { appServiceSpec, backupServiceSpec } from '../../src/services/specs.js';
import { plistArray, plistDict } from './helpers.js';

const p = currentPlatform({ platform: 'darwin', arch: 'arm64', uid: 501, env: { HOME: '/Users/a' } });
const sm = p.serviceManager;
const input = {
  execPath: '/opt/homebrew/opt/node@22/bin/node',
  checkout: '/Users/a/src/gmt',
  home: '/Users/a',
  paths: p.paths,
};
const app = sm.render(appServiceSpec(input), p.paths);
const backup = sm.render(backupServiceSpec(input), p.paths);
const PLIST = '/Users/a/Library/LaunchAgents/local.get-me-there.app.plist';

describe('launchd rendering (spec §13; brief §7 launchd keys)', () => {
  it('the app agent snapshot', () => {
    expect(app).toHaveLength(1);
    expect(app[0]?.path).toBe(PLIST);
    expect(app[0]?.unitName).toBe('local.get-me-there.app');
    expect(app[0]?.contents).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0">
      <dict>
        <key>Label</key>
        <string>local.get-me-there.app</string>
        <key>ProgramArguments</key>
        <array>
          <string>/opt/homebrew/opt/node@22/bin/node</string>
          <string>--env-file=/Users/a/.config/get-me-there/app.env</string>
          <string>/Users/a/src/gmt/apps/api/dist/bootstrap/start.js</string>
        </array>
        <key>WorkingDirectory</key>
        <string>/Users/a/src/gmt</string>
        <key>EnvironmentVariables</key>
        <dict>
          <key>HOME</key>
          <string>/Users/a</string>
          <key>PATH</key>
          <string>/opt/homebrew/opt/node@22/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        </dict>
        <key>RunAtLoad</key>
        <true/>
        <key>KeepAlive</key>
        <dict>
          <key>SuccessfulExit</key>
          <false/>
        </dict>
        <key>ThrottleInterval</key>
        <integer>60</integer>
        <key>ExitTimeOut</key>
        <integer>30</integer>
        <key>StandardOutPath</key>
        <string>/Users/a/Library/Logs/get-me-there/app.log</string>
        <key>StandardErrorPath</key>
        <string>/Users/a/Library/Logs/get-me-there/app.log</string>
      </dict>
      </plist>
      "
    `);
  });

  it('the backup job is a calendar agent at 03:30 with no KeepAlive and no RunAtLoad', () => {
    const t = backup[0]?.contents ?? '';
    expect(backup[0]?.unitName).toBe('local.get-me-there.backup');
    expect(t).toContain(
      '<key>StartCalendarInterval</key>\n  <dict>\n    <key>Hour</key>\n    <integer>3</integer>\n    <key>Minute</key>\n    <integer>30</integer>\n  </dict>',
    );
    expect(t).not.toContain('KeepAlive');
    expect(t).not.toContain('RunAtLoad');
    expect(plistArray(t, 'ProgramArguments')).toEqual(backupServiceSpec(input).argv);
  });

  it('a worker spec gets its own throttle', () => {
    const worker: ServiceSpec = {
      ...appServiceSpec(input),
      name: 'camoufox-worker',
      throttleSeconds: 600,
      preventRestartExitStatus: 78,
    };
    const t = sm.render(worker, p.paths)[0]?.contents ?? '';
    expect(t).toContain('<key>ThrottleInterval</key>\n  <integer>600</integer>');
    expect(t).toContain('camoufox-worker.log');
  });

  it('property: ProgramArguments parsed back equal the argv, whatever the paths hold', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ unit: fc.constantFrom('a', ' ', '&', '<', '>', '"', "'", '%', '$', '\\', 'é') }),
          { maxLength: 4 },
        ),
        (words) => {
          const argv = ['/n o/de', ...words];
          const r = sm.render({ ...appServiceSpec(input), argv }, p.paths);
          expect(plistArray(r[0]?.contents ?? '', 'ProgramArguments')).toEqual(argv);
        },
      ),
    );
  });

  it('EnvironmentVariables is exactly PATH and HOME', () => {
    for (const r of [...app, ...backup])
      expect(Object.keys(plistDict(r.contents, 'EnvironmentVariables')).sort()).toEqual(['HOME', 'PATH']);
  });

  it('no rendered file names pnpm or corepack', () => {
    for (const r of [...app, ...backup]) expect(r.contents).not.toMatch(/pnpm|corepack/);
  });
});

const facts = (f: Partial<ServiceFacts>): ServiceFacts => ({
  onDisk: null,
  loaded: false,
  state: 'not-installed',
  ...f,
});

describe('launchd facts and planning (pure over the facts)', () => {
  it('facts reads the file and launchctl print gui/<uid>/<label> once each', async () => {
    const fs = new MemoryFs().file(PLIST, 'old');
    const run = memoryRunner(fs, (argv) =>
      argv[0] === 'launchctl' ? { code: 0, stdout: '\tstate = running\n\tpid = 7\n' } : undefined,
    );
    const f = await sm.facts(app, run);
    expect(f.get('local.get-me-there.app')).toEqual({ onDisk: 'old', loaded: true, state: 'running' });
    expect(run.calls.map((c) => c.argv)).toEqual([
      ['cat', PLIST],
      ['launchctl', 'print', 'gui/501/local.get-me-there.app'],
    ]);
  });

  it.each([
    ['\tstate = not running\n\tlast exit code = 0\n', 0, true, 'stopped'],
    ['\tstate = not running\n\tlast exit code = 78: EX_CONFIG\n', 0, true, 'failed'],
    ['\tstate = not running\n\tlast exit code = (never exited)\n', 0, true, 'stopped'],
    ['', 113, false, 'stopped'],
  ] as const)('print %j (exit %d) gives loaded %s, %s', async (stdout, code, loaded, state) => {
    const fs = new MemoryFs().file(PLIST, 'x');
    const run = memoryRunner(fs, (argv) => (argv[0] === 'launchctl' ? { code, stdout } : undefined));
    expect((await sm.facts(app, run)).get('local.get-me-there.app')).toEqual({ onDisk: 'x', loaded, state });
  });

  it('no file and not loaded is not-installed', async () => {
    const fs = new MemoryFs();
    const run = memoryRunner(fs, (argv) => (argv[0] === 'launchctl' ? { code: 113 } : undefined));
    expect((await sm.facts(app, run)).get('local.get-me-there.app')).toEqual(facts({}));
  });

  const key = 'local.get-me-there.app';
  const contents = app[0]?.contents ?? '';
  it('an unchanged file plans nothing', () => {
    expect(
      sm.install(app, new Map([[key, facts({ onDisk: contents, loaded: true, state: 'running' })]])),
    ).toEqual([]);
  });
  it('a new file is written then bootstrapped', () => {
    const a = sm.install(app, new Map([[key, facts({})]]));
    expect(a.map((x) => (x.kind === 'run' ? x.describe : x.kind))).toEqual([
      'writeFile',
      `launchctl bootstrap gui/501 ${PLIST}`,
    ]);
    expect(a[0]).toMatchObject({ kind: 'writeFile', path: PLIST, mode: 0o644, secret: false, contents });
  });
  it('a changed file when loaded: bootout, write, bootstrap', () => {
    const a = sm.install(app, new Map([[key, facts({ onDisk: 'old', loaded: true, state: 'running' })]]));
    expect(a.map((x) => (x.kind === 'run' ? x.argv.join(' ') : x.kind))).toEqual([
      'launchctl bootout gui/501/local.get-me-there.app',
      'waitGone',
      'writeFile',
      `launchctl bootstrap gui/501 ${PLIST}`,
    ]);
  });
  it('a changed file when not loaded: no bootout', () => {
    const a = sm.install(app, new Map([[key, facts({ onDisk: 'old', state: 'stopped' })]]));
    expect(a.map((x) => x.kind)).toEqual(['writeFile', 'run']);
  });
  it('missing facts count as not installed', () => {
    expect(sm.install(app, new Map()).map((x) => x.kind)).toEqual(['writeFile', 'run']);
  });

  it('start, stop and restart by state', () => {
    const argv = (as: ReturnType<typeof sm.start>) =>
      as.map((x) => (x.kind === 'run' ? x.argv.join(' ') : x.kind));
    const loaded = facts({ onDisk: contents, loaded: true, state: 'stopped' });
    const running = { ...loaded, state: 'running' as const };
    const unloaded = facts({ onDisk: contents, state: 'stopped' });
    expect(argv(sm.start(key, loaded))).toEqual(['launchctl kickstart gui/501/local.get-me-there.app']);
    expect(argv(sm.start(key, running))).toEqual([]);
    expect(argv(sm.start(key, unloaded))).toEqual([`launchctl bootstrap gui/501 ${PLIST}`]);
    expect(argv(sm.start(key, facts({})))).toEqual([]);
    expect(argv(sm.stop(key, running))).toEqual([
      'launchctl bootout gui/501/local.get-me-there.app',
      'waitGone',
    ]);
    expect(argv(sm.stop(key, unloaded))).toEqual([]);
    expect(argv(sm.restart(key, running))).toEqual([
      'launchctl bootout gui/501/local.get-me-there.app',
      'waitGone',
      `launchctl bootstrap gui/501 ${PLIST}`,
    ]);
    expect(argv(sm.restart(key, unloaded))).toEqual([`launchctl bootstrap gui/501 ${PLIST}`]);
    expect(argv(sm.restart(key, facts({})))).toEqual([]);
  });

  it('remove: bootout when loaded, then delete the file; nothing for nothing', () => {
    const a = sm.remove(app, new Map([[key, facts({ onDisk: contents, loaded: true, state: 'running' })]]));
    expect(
      a.map((x) => (x.kind === 'run' ? x.argv.join(' ') : `${x.kind} ${'path' in x ? x.path : ''}`)),
    ).toEqual(['launchctl bootout gui/501/local.get-me-there.app', 'waitGone ', `remove ${PLIST}`]);
    expect(sm.remove(app, new Map([[key, facts({})]]))).toEqual([]);
  });
});

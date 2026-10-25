import { describe, expect, it } from 'vitest';
import { currentPlatform } from '../../src/platform/current.js';
import {
  describeChecks,
  scheduleUnit,
  settingsChecks,
  staleChecks,
  unitTargets,
} from '../../src/services/checks.js';
import { factOf, factsOf, NOT_INSTALLED, serviceSet } from '../../src/services/set.js';
import { appServiceSpec } from '../../src/services/specs.js';
import { testWorld } from '../support/deps.js';

const ENV = '/Users/op/.config/get-me-there/app.env';
const WORKER = '/Users/op/.local/state/get-me-there/camoufox/worker.env';

describe('settingsChecks (spec §12: present, the user’s own, 0600)', () => {
  it('app.env missing is a fail with pnpm gmt setup; worker.env missing is no check', () => {
    expect(settingsChecks(testWorld().deps)).toEqual([
      { name: 'settings app.env', level: 'fail', detail: `${ENV} is missing`, fix: 'pnpm gmt setup' },
    ]);
  });
  it('a file others can read is a fail naming chmod 600; another owner a fail naming chown; else ok', () => {
    const w = testWorld();
    w.fs.file(ENV, 'x', 0o600).file(WORKER, 'k', 0o604);
    expect(settingsChecks(w.deps)).toEqual([
      { name: 'settings app.env', level: 'ok', detail: '0600, yours', fix: null },
      {
        name: 'settings worker.env',
        level: 'fail',
        detail: `${WORKER} is readable by others (0604)`,
        fix: `chmod 600 ${WORKER}`,
      },
    ]);
    w.fs.file(WORKER, 'k', 0o600).chown(WORKER, 0);
    expect(settingsChecks(w.deps)[1]).toEqual({
      name: 'settings worker.env',
      level: 'fail',
      detail: `${WORKER} belongs to another user`,
      fix: `chown op ${WORKER}`,
    });
    for (const m of [0o640, 0o602, 0o610]) {
      w.fs.file(ENV, 'x', m);
      expect(settingsChecks(w.deps)[0]?.level).toBe('fail');
    }
  });
});

describe('unitTargets and staleChecks (spec §13: a unit whose Node or checkout is gone)', () => {
  const w = testWorld();
  const p = w.deps.platform;
  const plist =
    p.serviceManager.render(
      {
        ...appServiceSpec({
          execPath: '/opt/n&b/node',
          checkout: '/r <x>',
          home: '/Users/op',
          paths: p.paths,
        }),
      },
      p.paths,
    )[0]?.contents ?? '';
  const linux = currentPlatform({ platform: 'linux', arch: 'x64', uid: 1, env: { HOME: '/h' } });
  const unit =
    linux.serviceManager.render(
      appServiceSpec({ execPath: '/o "p"/a\\b%c$d/node', checkout: '/w %d', home: '/h', paths: linux.paths }),
      linux.paths,
    )[0]?.contents ?? '';
  it('reads the Node binary and the working directory from a plist and from a unit, escapes undone', () => {
    expect(unitTargets(plist)).toEqual({ node: '/opt/n&b/node', dir: '/r <x>' });
    expect(unitTargets(unit)).toEqual({ node: '/o "p"/a\\b%c$d/node', dir: '/w %d' });
    expect(unitTargets('nothing here')).toEqual({ node: null, dir: null });
    expect(unitTargets('<key>ProgramArguments</key>\n<array>\n<string>/n</string>')).toEqual({
      node: '/n',
      dir: null,
    });
    expect(unitTargets('[Service]\nWorkingDirectory=/d\n')).toEqual({ node: null, dir: '/d' });
  });
  it('a gone binary and a gone checkout are each a fail with pnpm gmt setup; an absent unit is skipped', () => {
    const entries = serviceSet(w.deps);
    const app = entries[0];
    if (app === undefined) throw new Error('no app');
    const facts = new Map([
      [app.unit, { onDisk: app.rendered[0]?.contents ?? '', loaded: true, state: 'running' as const }],
    ]);
    expect(staleChecks(w.deps, entries, facts)).toEqual([
      {
        name: 'unit app',
        level: 'fail',
        detail: 'its Node binary /opt/node/bin/node is gone',
        fix: 'pnpm gmt setup',
      },
      { name: 'unit app', level: 'fail', detail: 'the checkout /repo is gone', fix: 'pnpm gmt setup' },
    ]);
    w.fs.file('/opt/node/bin/node', 'n').dir('/repo');
    expect(staleChecks(w.deps, entries, facts)).toEqual([]);
    expect(staleChecks(w.deps, entries, new Map())).toEqual([]);
  });
});

describe('unitTargets edge cases (ts-b1-014)', () => {
  it('a unit naming neither key yields no targets and no check', () => {
    expect(unitTargets('[Unit]\nDescription=x\n[Service]\nType=simple\n')).toEqual({ node: null, dir: null });
    const w = testWorld({ os: 'linux' });
    const set = serviceSet(w.deps);
    const facts = new Map(
      set.map((e) => [
        e.unit,
        { onDisk: '[Service]\nType=simple\n', loaded: true, state: 'running' as const },
      ]),
    );
    expect(staleChecks(w.deps, set, facts)).toEqual([]);
  });
  it('a commented WorkingDirectory or a stray line before ExecStart is not read as the real one', () => {
    const unit =
      '[Service]\n# WorkingDirectory=/old\n; ExecStart="/old/node" x\nWorkingDirectory=/repo\nExecStart="/opt/node/bin/node" "/repo/x.js"\n';
    expect(unitTargets(unit)).toEqual({ node: '/opt/node/bin/node', dir: '/repo' });
  });
});

describe('the services carry HOME (ts-b1-003)', () => {
  it('every rendered service holds the HOME the CLI resolved, never an empty one', () => {
    for (const os of ['darwin', 'linux'] as const) {
      const w = testWorld({ os });
      for (const e of serviceSet(w.deps)) {
        expect(e.spec.environment.HOME).toBe(w.deps.home);
        expect(e.spec.environment.HOME).not.toBe('');
        expect(e.rendered.map((r) => r.contents).join('\n')).toContain(w.deps.home);
      }
    }
  });
});

describe('the service set and its facts', () => {
  it('the app then the backup job, each with its unit; the job is scheduled by its timer on Linux', async () => {
    const d = testWorld().deps;
    const set = serviceSet(d);
    expect(set.map((e) => [e.name, e.unit, scheduleUnit(e)])).toEqual([
      ['app', 'local.get-me-there.app', 'local.get-me-there.app'],
      ['backup', 'local.get-me-there.backup', 'local.get-me-there.backup'],
    ]);
    expect(set[0]?.spec.argv[0]).toBe('/opt/node/bin/node');
    const l = testWorld({ os: 'linux' }).deps;
    expect(serviceSet(l).map((e) => [e.unit, scheduleUnit(e)])).toEqual([
      ['get-me-there-app.service', 'get-me-there-app.service'],
      ['get-me-there-backup.service', 'get-me-there-backup.timer'],
    ]);
    const facts = await factsOf(l, serviceSet(l));
    expect([...facts.keys()]).toEqual([
      'get-me-there-app.service',
      'get-me-there-backup.service',
      'get-me-there-backup.timer',
    ]);
    expect(factOf(facts, 'none')).toEqual(NOT_INSTALLED);
    expect(NOT_INSTALLED).toEqual({ onDisk: null, loaded: false, state: 'not-installed' });
  });
});

describe('describeChecks', () => {
  it('pads the name to the widest (at least 10) and the level to 4, with each fix on its own indented line', () => {
    expect(
      describeChecks([
        { name: 'a', level: 'ok', detail: 'fine', fix: null },
        { name: 'b', level: 'fail', detail: 'bad', fix: 'do it' },
      ]),
    ).toBe(`a           ok    fine\nb           fail  bad\n${' '.repeat(18)}fix: do it\n`);
    expect(describeChecks([{ name: 'a-much-longer-name', level: 'warn', detail: 'x', fix: null }])).toBe(
      'a-much-longer-name  warn  x\n',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { MemoryFs, memoryExecutor, memoryRunner } from '../../src/exec/memory.js';
import { describeAction } from '../../src/plan/describe.js';
import { currentPlatform } from '../../src/platform/current.js';
import type { ServiceFacts } from '../../src/platform/types.js';
import { appServiceSpec, stableNodePath } from '../../src/services/specs.js';

// why: U5 (dev-b1-001, -002, -003, -009, po-b1-004)
const mac = currentPlatform({ platform: 'darwin', arch: 'arm64', uid: 501, env: { HOME: '/Users/a' } });
const lin = currentPlatform({ platform: 'linux', arch: 'x64', uid: 1000, env: { HOME: '/home/a' } });
const app = mac.serviceManager.render(
  appServiceSpec({ execPath: '/n/node', checkout: '/c', home: '/Users/a', paths: mac.paths }),
  mac.paths,
);
const KEY = 'local.get-me-there.app';
const loaded: ServiceFacts = { onDisk: 'old', loaded: true, state: 'running' };
const show = (as: ReturnType<typeof mac.serviceManager.restart>) => as.map(describeAction);

describe('launchd stops gracefully and waits for the label to go (U5)', () => {
  it('restart is bootout (SIGTERM), a bounded wait until launchctl print fails, then bootstrap; never kickstart -k', () => {
    expect(show(mac.serviceManager.restart(KEY, loaded))).toEqual([
      'run launchctl bootout gui/501/local.get-me-there.app',
      'wait up to 45 s until launchctl print gui/501/local.get-me-there.app fails',
      'run launchctl bootstrap gui/501 /Users/a/Library/LaunchAgents/local.get-me-there.app.plist',
    ]);
    expect(show(mac.serviceManager.restart(KEY, loaded)).join('\n')).not.toContain('kickstart -k');
  });
  it('a changed plist that is loaded: bootout, wait, write, bootstrap; stop is bootout then the wait', () => {
    expect(show(mac.serviceManager.install(app, new Map([[KEY, loaded]])))).toEqual([
      'run launchctl bootout gui/501/local.get-me-there.app',
      'wait up to 45 s until launchctl print gui/501/local.get-me-there.app fails',
      'write /Users/a/Library/LaunchAgents/local.get-me-there.app.plist (0644, 38 lines)',
      'run launchctl bootstrap gui/501 /Users/a/Library/LaunchAgents/local.get-me-there.app.plist',
    ]);
    expect(show(mac.serviceManager.stop(KEY, loaded))).toEqual([
      'run launchctl bootout gui/501/local.get-me-there.app',
      'wait up to 45 s until launchctl print gui/501/local.get-me-there.app fails',
    ]);
  });
  it('the memory executor runs the wait’s probe until it fails, and fails when it never does', async () => {
    const fs = new MemoryFs();
    let prints = 0;
    const runner = memoryRunner(fs, (argv) =>
      argv[1] === 'print' ? { code: ++prints < 3 ? 0 : 113 } : undefined,
    );
    const ex = memoryExecutor(fs, { runner });
    for (const a of mac.serviceManager.stop(KEY, loaded)) await ex.run(a);
    expect(prints).toBe(3);
    const stuck = memoryExecutor(fs, { runner: memoryRunner(fs, () => ({ code: 0 })) });
    const wait = mac.serviceManager.stop(KEY, loaded)[1];
    if (wait === undefined) throw new Error('no wait');
    await expect(stuck.run(wait)).rejects.toThrow('still answers after 45 s');
  });
});

describe('systemd: activating is not running (U5, dev-b1-003)', () => {
  it('a unit in its restart wait reads as failed', async () => {
    const r = lin.serviceManager.render(
      appServiceSpec({ execPath: '/n', checkout: '/c', home: '/home/a', paths: lin.paths }),
      lin.paths,
    );
    const run = memoryRunner(new MemoryFs().file(r[0]?.path ?? '', 'x'), (a) =>
      a[0] === 'systemctl' ? { code: 3, stdout: 'activating\n' } : undefined,
    );
    expect((await lin.serviceManager.facts(r, run)).get('get-me-there-app.service')?.state).toBe('failed');
  });
});

describe('stableNodePath (U5, dev-b1-002, po-b1-004)', () => {
  const fs = new MemoryFs()
    .file('/opt/homebrew/Cellar/node@22/22.23.2/bin/node', 'node')
    .symlink('/opt/homebrew/opt/node@22/bin/node', '/opt/homebrew/Cellar/node@22/22.23.2/bin/node')
    .symlink('/opt/homebrew/bin/node', '/opt/homebrew/Cellar/node@22/22.23.2/bin/node')
    .file('/usr/local/bin/node', 'another node');
  const cellar = '/opt/homebrew/Cellar/node@22/22.23.2/bin/node';
  it('prefers the node on PATH that is the same binary, unresolved', () => {
    expect(stableNodePath(cellar, ['/usr/local/bin', '/opt/homebrew/bin'], fs)).toBe(
      '/opt/homebrew/bin/node',
    );
  });
  it('else Homebrew’s opt link for that Cellar keg', () => {
    expect(stableNodePath(cellar, ['/usr/local/bin'], fs)).toBe('/opt/homebrew/opt/node@22/bin/node');
  });
  it('else the path it ran from', () => {
    expect(
      stableNodePath(
        '/home/a/.nvm/versions/node/v22.18.0/bin/node',
        ['/usr/bin'],
        new MemoryFs().file('/home/a/.nvm/versions/node/v22.18.0/bin/node', 'n'),
      ),
    ).toBe('/home/a/.nvm/versions/node/v22.18.0/bin/node');
  });
});

describe('a path holding a control character is refused (U8, sec-b1-006)', () => {
  it('both renderers refuse it, and controlProblem names it', async () => {
    const { controlProblem } = await import('../../src/services/specs.js');
    const bad = appServiceSpec({
      execPath: '/n/node',
      checkout: '/c\nExecStartPre=/bin/true',
      home: '/h',
      paths: lin.paths,
    });
    expect(() => lin.serviceManager.render(bad, lin.paths)).toThrow('control character');
    expect(() => mac.serviceManager.render(bad, mac.paths)).toThrow('control character');
    expect(controlProblem({ checkout: '/c\n', home: '/h' })).toBe(
      'the checkout path holds a control character (a newline or similar)',
    );
    expect(controlProblem({ checkout: '/c', home: '/h' })).toBeNull();
  });
});

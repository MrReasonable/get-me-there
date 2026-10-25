import { workerDataDir } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { currentPlatform } from '../../src/platform/current.js';
import { WIN32_REFUSAL } from '../../src/platform/win32.js';

describe('currentPlatform (brief WP16b §5, Task 16b.2)', () => {
  it('darwin: §5 paths under HOME, the uid, a display', () => {
    const p = currentPlatform({ platform: 'darwin', arch: 'arm64', uid: 501, env: { HOME: '/Users/a' } });
    expect([p.os, p.arch, p.uid, p.hasDisplay]).toEqual(['darwin', 'arm64', 501, true]);
    expect(p.paths).toEqual({
      config: '/Users/a/.config/get-me-there',
      data: '/Users/a/.local/share/get-me-there',
      state: '/Users/a/.local/state/get-me-there',
      workerData: workerDataDir('/Users/a'),
      camoufoxRoot: '/Users/a/.local/share/get-me-there/camoufox',
      logs: '/Users/a/Library/Logs/get-me-there',
      serviceDir: '/Users/a/Library/LaunchAgents',
    });
  });

  it('darwin ignores XDG variables entirely', () => {
    const p = currentPlatform({
      platform: 'darwin',
      arch: 'x64',
      uid: 501,
      env: { HOME: '/Users/a', XDG_CONFIG_HOME: '/x/c', XDG_DATA_HOME: '/x/d', XDG_STATE_HOME: '/x/s' },
    });
    expect(p.paths.config).toBe('/Users/a/.config/get-me-there');
    expect(p.paths.data).toBe('/Users/a/.local/share/get-me-there');
  });

  it('linux: defaults under HOME, logs null (the journal), units under ~/.config/systemd/user', () => {
    const p = currentPlatform({ platform: 'linux', arch: 'x64', uid: 1000, env: { HOME: '/home/a' } });
    expect(p.paths).toEqual({
      config: '/home/a/.config/get-me-there',
      data: '/home/a/.local/share/get-me-there',
      state: '/home/a/.local/state/get-me-there',
      workerData: workerDataDir('/home/a'),
      camoufoxRoot: '/home/a/.local/share/get-me-there/camoufox',
      logs: null,
      serviceDir: '/home/a/.config/systemd/user',
    });
  });

  it('linux honours absolute XDG homes for config, data and state, never for workerData or camoufoxRoot', () => {
    const p = currentPlatform({
      platform: 'linux',
      arch: 'arm64',
      uid: 1000,
      env: { HOME: '/home/a', XDG_CONFIG_HOME: '/x/c', XDG_DATA_HOME: '/x/d', XDG_STATE_HOME: '/x/s' },
    });
    expect(p.paths.config).toBe('/x/c/get-me-there');
    expect(p.paths.data).toBe('/x/d/get-me-there');
    expect(p.paths.state).toBe('/x/s/get-me-there');
    expect(p.paths.workerData).toBe(workerDataDir('/home/a'));
    expect(p.paths.camoufoxRoot).toBe('/home/a/.local/share/get-me-there/camoufox');
  });

  it('linux ignores relative or empty XDG homes', () => {
    const p = currentPlatform({
      platform: 'linux',
      arch: 'x64',
      uid: 1000,
      env: { HOME: '/home/a', XDG_CONFIG_HOME: 'rel/c', XDG_DATA_HOME: '', XDG_STATE_HOME: './s' },
    });
    expect([p.paths.config, p.paths.data, p.paths.state]).toEqual([
      '/home/a/.config/get-me-there',
      '/home/a/.local/share/get-me-there',
      '/home/a/.local/state/get-me-there',
    ]);
  });

  it.each([
    [{}, false],
    [{ DISPLAY: '' }, false],
    [{ WAYLAND_DISPLAY: '' }, false],
    [{ DISPLAY: ':0' }, true],
    [{ WAYLAND_DISPLAY: 'wayland-0' }, true],
  ])('linux hasDisplay with %j is %s', (extra, want) => {
    expect(
      currentPlatform({ platform: 'linux', arch: 'x64', uid: 1, env: { HOME: '/h', ...extra } }).hasDisplay,
    ).toBe(want);
  });

  it.each(['darwin', 'linux'] as const)('%s writeSecretFile is a 0600 secret writeFile', (os) => {
    const p = currentPlatform({ platform: os, arch: 'x64', uid: 1, env: { HOME: '/h' } });
    expect(p.writeSecretFile('/h/s.env', 'K=v\n')).toEqual({
      kind: 'writeFile',
      path: '/h/s.env',
      contents: 'K=v\n',
      mode: 0o600,
      secret: true,
    });
  });

  it('refuses a home that is missing or relative, an arch and an OS it has no rules for', () => {
    expect(() => currentPlatform({ platform: 'linux', arch: 'x64', uid: 1, env: {} })).toThrow('HOME');
    expect(() => currentPlatform({ platform: 'linux', arch: 'x64', uid: 1, env: { HOME: 'h' } })).toThrow(
      'HOME',
    );
    expect(() => currentPlatform({ platform: 'linux', arch: 'ia32', uid: 1, env: { HOME: '/h' } })).toThrow(
      'ia32',
    );
    expect(() => currentPlatform({ platform: 'freebsd', arch: 'x64', uid: 1, env: { HOME: '/h' } })).toThrow(
      'freebsd',
    );
  });

  it('win32: a platform whose service manager refuses with the one Windows sentence', () => {
    const p = currentPlatform({ platform: 'win32', arch: 'x64', uid: -1, env: { HOME: 'C:\\Users\\a' } });
    expect(p.os).toBe('win32');
    expect(WIN32_REFUSAL).toBe('Windows setup is not built yet; run the app with Docker (docs/setup.md)');
    const spec = {
      name: 'app',
      argv: ['node'],
      workingDirectory: 'C:\\r',
      environment: { PATH: 'C:\\n', HOME: 'C:\\Users\\a' },
      restart: 'on-failure',
      preventRestartExitStatus: null,
      throttleSeconds: 60,
      calendar: null,
    } as const;
    expect(() => p.serviceManager.render(spec, p.paths)).toThrow(WIN32_REFUSAL);
    expect(p.paths.config).toBe('C:\\Users\\a\\.config\\get-me-there');
  });
});

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InstallRefused } from '../src/install.js';
import {
  BACKGROUND_PREFS,
  buildLaunchOptions,
  installedCamoufoxJsVersion,
  launchContext,
  launchOptionsForMeta,
  prepareLaunch,
} from '../src/launch.js';
import { fakeInstall, tmpDir } from './support/tmp.js';

const opts = buildLaunchOptions({ ffMajor: 152, home: '/Users/op', path: '/usr/bin', tmp: '/tmp' });

describe('buildLaunchOptions (spec §2 limits; brief §7)', () => {
  it('is exactly the pinned option set', () => {
    expect(opts).toEqual({
      headless: true,
      locale: 'en-GB',
      os: 'macos',
      ff_version: 152,
      i_know_what_im_doing: true,
      exclude_addons: ['UBO'],
      geoip: false,
      serviceWorkers: 'block',
      handleSIGTERM: false,
      handleSIGINT: false,
      handleSIGHUP: false,
      // why: ruling 7 of 2026-10-18 (WP15 round 1): a fixed window, so the date grid's layout never follows a generated
      // screen size
      window: [1280, 900],
      env: { HOME: '/Users/op', PATH: '/usr/bin', TMPDIR: '/tmp', LANG: 'en_GB.UTF-8' },
      firefox_user_prefs: {
        'toolkit.telemetry.enabled': false,
        'datareporting.healthreport.uploadEnabled': false,
        'datareporting.policy.dataSubmissionEnabled': false,
        'browser.crashReports.unsubmittedCheck.autoSubmit2': false,
        'app.normandy.enabled': false,
        'network.captive-portal-service.enabled': false,
      },
    });
  });
  it('has no executable_path, proxy, humanize, fingerprint or config key (by key list)', () => {
    expect(Object.keys(opts).sort()).toEqual(
      [
        'headless',
        'locale',
        'os',
        'ff_version',
        'i_know_what_im_doing',
        'exclude_addons',
        'geoip',
        'serviceWorkers',
        'handleSIGTERM',
        'handleSIGINT',
        'handleSIGHUP',
        'window',
        'env',
        'firefox_user_prefs',
      ].sort(),
    );
    for (const k of [
      'executable_path',
      'proxy',
      'humanize',
      'fingerprint',
      'config',
      'addons',
      'enable_cache',
    ])
      expect(k in opts).toBe(false);
    expect(Object.keys(BACKGROUND_PREFS)).toHaveLength(6);
  });
  it('a recording meta stores the options without env (PIE-R2-11)', () => {
    const meta = launchOptionsForMeta(opts);
    expect('env' in meta).toBe(false);
    expect(meta.exclude_addons).toEqual(['UBO']);
  });
  it('reads camoufox-js’s own package.json version', () => {
    expect(installedCamoufoxJsVersion()).toBe('0.11.5');
  });
});

describe('prepareLaunch (brief WP17 Task 17.2: the checks before camoufox-js is imported)', () => {
  const base = { path: '/usr/bin', tmp: '/tmp' };
  it('macOS: the install directory run.ts set, the layout and the camoufox-js pin, then the options; the launch env unchanged', () => {
    const f = fakeInstall('darwin-arm64');
    const data = tmpDir();
    const p = prepareLaunch({
      ...base,
      platform: 'darwin',
      arch: 'arm64',
      installDirSet: f.root,
      dataDir: data,
      home: f.home,
    });
    expect(p.camoufoxJs).toBe('0.11.5');
    expect(p.install.build).toBe('152.0.4-beta.28');
    expect(p.options).toEqual(
      buildLaunchOptions({ ffMajor: 152, home: f.home, path: '/usr/bin', tmp: '/tmp' }),
    );
    expect(Object.keys(p.options.env)).toEqual(['HOME', 'PATH', 'TMPDIR', 'LANG']);
    expect(existsSync(join(data, 'fonts.conf'))).toBe(false);
  });
  it('Linux: writes <workerData>/fonts.conf naming the bundle’s fonts/macos absolutely and passes it as FONTCONFIG_FILE, os macos kept', () => {
    const f = fakeInstall('linux-arm64');
    const data = tmpDir();
    const p = prepareLaunch({
      ...base,
      platform: 'linux',
      arch: 'arm64',
      installDirSet: f.bundleDir,
      dataDir: data,
      home: f.home,
    });
    const conf = join(data, 'fonts.conf');
    expect(p.options.env).toEqual({
      HOME: f.home,
      PATH: '/usr/bin',
      TMPDIR: '/tmp',
      LANG: 'en_GB.UTF-8',
      FONTCONFIG_FILE: conf,
    });
    expect(p.options.os).toBe('macos');
    expect(readFileSync(conf, 'utf8')).toBe(
      `<?xml version="1.0"?>\n<fontconfig>\n  <dir>${f.bundleDir}/fonts/macos</dir>\n  <cachedir>~/.cache</cachedir>\n</fontconfig>\n`,
    );
    expect(statSync(conf).mode & 0o777).toBe(0o600);
  });
  it('refuses an install directory other than this machine’s, before reading the layout', () => {
    const f = fakeInstall('darwin-arm64');
    for (const set of [undefined, '/elsewhere'])
      expect(() =>
        prepareLaunch({
          ...base,
          platform: 'darwin',
          arch: 'arm64',
          installDirSet: set,
          dataDir: tmpDir(),
          home: f.home,
        }),
      ).toThrow(
        new InstallRefused(
          'layout',
          `CAMOUFOX_INSTALL_DIR is not ${f.root}; start the worker through run.ts, which sets it`,
        ),
      );
  });
  // why: fix round 1 (prov-int M2): the camoufox-js pin is checked, through a seam, in both places
  it('refuses another camoufox-js version (0.11.6) naming the pin', () => {
    const f = fakeInstall('darwin-arm64');
    expect(() =>
      prepareLaunch({
        ...base,
        platform: 'darwin',
        arch: 'arm64',
        installDirSet: f.root,
        dataDir: tmpDir(),
        home: f.home,
        readCamoufoxJs: () => '0.11.6',
      }),
    ).toThrow('camoufox-js is 0.11.6; this worker is verified against 0.11.5 only');
  });
  it('refuses Windows, and a machine with no pinned build, before touching any install directory', () => {
    const o = { ...base, installDirSet: '/x', dataDir: '/nowhere', home: '/nowhere' };
    expect(() => prepareLaunch({ ...o, platform: 'win32', arch: 'x64' })).toThrow(
      /runs on macOS and Linux only/,
    );
    expect(() => prepareLaunch({ ...o, platform: 'linux', arch: 'ia32' })).toThrow(
      'no Camoufox build is pinned for linux-ia32',
    );
  });
});

describe('launchContext (the pin again, at the launch itself)', () => {
  it('refuses another camoufox-js version before importing it', async () => {
    await expect(
      launchContext(
        buildLaunchOptions({ ffMajor: 152, home: '/h', path: '/p', tmp: '/t' }),
        '/nowhere',
        () => '0.11.6',
      ),
    ).rejects.toThrow('camoufox-js is 0.11.6; this worker is verified against 0.11.5 only');
  });
});

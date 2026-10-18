import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_PREFS,
  buildLaunchOptions,
  installedCamoufoxJsVersion,
  launchOptionsForMeta,
  prepareLaunch,
} from '../src/launch.js';
import { fakeInstall } from './support/tmp.js';

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

describe('prepareLaunch (brief Task 14.5 start checks, in order)', () => {
  const base = {
    pinnedBuild: '152.0.4-beta.28',
    installDirOverride: undefined,
    home: '/Users/op',
    path: '/usr/bin',
    tmp: '/tmp',
  };
  it('checks macOS, the install layout and the camoufox-js pin, then builds the options from the bundle', () => {
    const f = fakeInstall({ version: '152.0.4', build: 'beta.28' });
    const p = prepareLaunch({ ...base, platform: 'darwin', installDir: f.installDir });
    expect(p.camoufoxJs).toBe('0.11.5');
    expect(p.install.build).toBe('152.0.4-beta.28');
    expect(p.options).toEqual(
      buildLaunchOptions({ ffMajor: 152, home: '/Users/op', path: '/usr/bin', tmp: '/tmp' }),
    );
  });
  it('refuses off macOS before touching the install directory', () => {
    expect(() => prepareLaunch({ ...base, platform: 'linux', installDir: '/nowhere' })).toThrow(/macOS only/);
  });
});

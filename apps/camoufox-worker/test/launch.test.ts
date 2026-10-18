import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_PREFS,
  buildLaunchOptions,
  installedCamoufoxJsVersion,
  launchOptionsForMeta,
} from '../src/launch.js';

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

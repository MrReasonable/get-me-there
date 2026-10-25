import { lstatSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAMOUFOX_BUILDS } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureInstallLayout, InstallRefused, releaseAccepted } from '../src/install.js';
import { fakeInstall } from './support/tmp.js';

const MAC = CAMOUFOX_BUILDS['darwin-arm64'];
const LIN = CAMOUFOX_BUILDS['linux-arm64'];
const mac = (installDir: string) => ensureInstallLayout({ os: 'darwin', installDir, entry: MAC });
const lin = (installDir: string) => ensureInstallLayout({ os: 'linux', installDir, entry: LIN });
/** Every path under `dir` with its size and modification time: a check that writes nothing leaves this equal. */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const st = lstatSync(p);
      out.push(`${p} ${st.size} ${st.mtimeMs}`);
      if (st.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out;
}
const refusal = (f: () => unknown): { reason: string; message: string; build: string | null } => {
  try {
    f();
  } catch (e) {
    if (e instanceof InstallRefused) return { reason: e.reason, message: e.message, build: e.installedBuild };
    throw e;
  }
  throw new Error('no refusal');
};

beforeEach(() => {
  expect.hasAssertions();
});

describe('ensureInstallLayout on macOS (decision 73; Task 17.2): verifies only', () => {
  it('the layout gmt setup makes passes, reporting the bundle, the pin and the Firefox major, and nothing is written', () => {
    const f = fakeInstall('darwin-arm64');
    const before = snapshot(f.root);
    expect(mac(f.installDir)).toEqual({
      installDir: f.root,
      // why: the bundle is read through the link, so it is the resolved path (macOS's temporary root is under /private)
      bundleDir: join(realpathSync(f.root), 'browsers', 'official', '152.0.4-beta.28-8b7680a6'),
      build: '152.0.4-beta.28',
      ffMajor: 152,
    });
    expect(snapshot(f.root)).toEqual(before);
  });

  it('a missing Camoufox.app link or top-level version.json is a layout refusal; nothing is created', () => {
    for (const f of [
      fakeInstall('darwin-arm64', { link: false }),
      fakeInstall('darwin-arm64', { top: null }),
    ]) {
      const before = snapshot(f.root);
      expect(refusal(() => mac(f.installDir)).reason).toBe('layout');
      expect(snapshot(f.root)).toEqual(before);
    }
  });

  it('a missing or empty install directory refuses, naming pnpm gmt setup', () => {
    const f = fakeInstall('darwin-arm64');
    rmSync(f.root, { recursive: true });
    expect(refusal(() => mac(f.installDir))).toEqual({
      reason: 'layout',
      message: `no Camoufox install at ${f.root}: run pnpm gmt setup`,
      build: null,
    });
  });

  it('a link that is a real directory, points nowhere, or out of browsers/official refuses', () => {
    const real = fakeInstall('darwin-arm64', { link: false });
    writeFileSync(join(real.root, 'Camoufox.app'), 'not a link');
    expect(refusal(() => mac(real.installDir)).message).toBe(
      `${real.root}/Camoufox.app is not a symlink to a Camoufox bundle`,
    );
    const dangling = fakeInstall('darwin-arm64', { link: false });
    symlinkSync(join(dangling.root, 'gone'), join(dangling.root, 'Camoufox.app'));
    expect(refusal(() => mac(dangling.installDir)).message).toBe(
      `${dangling.root}/Camoufox.app points at nothing: run pnpm gmt setup`,
    );
    const outside = fakeInstall('darwin-arm64', { link: false });
    const elsewhere = fakeInstall('darwin-arm64');
    symlinkSync(join(elsewhere.bundleDir, 'Camoufox.app'), join(outside.root, 'Camoufox.app'));
    expect(refusal(() => mac(outside.installDir)).message).toMatch(
      /does not point into .*browsers\/official$/,
    );
  });

  it('a bundle without its binary or properties.json refuses naming the file', () => {
    const f = fakeInstall('darwin-arm64');
    rmSync(join(f.bundleDir, 'Camoufox.app', 'Contents', 'Resources', 'properties.json'));
    expect(refusal(() => mac(f.installDir)).message).toMatch(
      /has no .*Contents\/Resources\/properties\.json$/,
    );
  });

  it('a bundle of another build is build-mismatch, naming both builds', () => {
    const f = fakeInstall('darwin-arm64', {
      bundleVersion: { version: '153.0.1', build: 'beta.30', release: 'beta.30' },
      top: { version: '153.0.1', release: 'beta.30' },
    });
    expect(refusal(() => mac(f.installDir))).toEqual({
      reason: 'build-mismatch',
      message:
        'the installed Camoufox is 153.0.1-beta.30 but this worker is pinned to 152.0.4-beta.28; a new build is a re-verification',
      build: '153.0.1-beta.30',
    });
  });

  it('a top-level version.json that disagrees with its bundle, or one camoufox-js would not accept, is a layout refusal', () => {
    const disagree = fakeInstall('darwin-arm64', { top: { version: '152.0.4', release: 'beta.27' } });
    expect(refusal(() => mac(disagree.installDir)).message).toBe(
      `${disagree.root}/version.json disagrees with its bundle`,
    );
    const unsupported = fakeInstall('darwin-arm64', { top: { version: '152.0.4', release: '2' } });
    expect(refusal(() => mac(unsupported.installDir)).message).toBe(
      `${unsupported.root}/version.json: camoufox-js does not accept the release 2`,
    );
  });

  it('malformed version files are named: not JSON, no version, a non-numeric version, no release', () => {
    for (const [top, words] of [
      ['{', 'is missing or not JSON'],
      ['{}', 'has no version string'],
      ['{"version":"x.1","release":"beta.28"}', 'its version is not numeric'],
      ['{"version":"152.0.4"}', 'names no release'],
    ] as const) {
      const f = fakeInstall('darwin-arm64');
      writeFileSync(join(f.root, 'version.json'), top);
      expect(refusal(() => mac(f.installDir)).message).toContain(words);
    }
  });
});

describe('ensureInstallLayout on Linux (decision 73; Task 17.2): the bundle is the install directory', () => {
  it('passes with version.json, camoufox-bin, properties.json and fontconfig/macos/fonts.conf, writing nothing', () => {
    const f = fakeInstall('linux-arm64');
    const before = snapshot(f.bundleDir);
    expect(lin(f.installDir)).toEqual({
      installDir: f.bundleDir,
      bundleDir: f.bundleDir,
      build: '152.0.4-beta.28',
      ffMajor: 152,
    });
    expect(snapshot(f.bundleDir)).toEqual(before);
  });

  it.each(['version.json', 'camoufox-bin', 'properties.json', 'fontconfig/macos/fonts.conf'])(
    'without %s it is a layout refusal',
    (file) => {
      const f = fakeInstall('linux-arm64');
      rmSync(join(f.bundleDir, file));
      expect(refusal(() => lin(f.installDir)).reason).toBe('layout');
    },
  );

  it('a release camoufox-js would not accept, or another build, refuses', () => {
    const bad = fakeInstall('linux-arm64', { bundleVersion: { version: '152.0.4', release: 'alpha.1' } });
    expect(refusal(() => lin(bad.installDir)).reason).toBe('layout');
    const other = fakeInstall('linux-arm64', { bundleVersion: { version: '152.0.4', build: 'beta.29' } });
    expect(refusal(() => lin(other.installDir))).toMatchObject({
      reason: 'build-mismatch',
      build: '152.0.4-beta.29',
    });
  });

  it('a missing or empty bundle directory refuses', () => {
    const f = fakeInstall('linux-arm64');
    rmSync(f.bundleDir, { recursive: true });
    expect(refusal(() => lin(f.installDir)).message).toBe(
      `no Camoufox install at ${f.bundleDir}: run pnpm gmt setup`,
    );
  });
});

describe('releaseAccepted: camoufox-js 0.11.5’s own range, strictly between alpha.1 and 1', () => {
  it('accepts the pins and refuses the edges', () => {
    expect(['beta.28', 'beta.1', 'alpha.2', 'rc.1', '0.9'].map(releaseAccepted)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(['alpha.1', 'alpha.0', '1', '2', '1.0.1'].map(releaseAccepted)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(releaseAccepted(LIN.build.split('-')[1] ?? '')).toBe(true);
  });
});

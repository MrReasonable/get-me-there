import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ensureInstallLayout } from '../src/install.js';
import { fakeInstall } from './support/tmp.js';

const PIN = '152.0.4-beta.28';
const BUNDLE = { version: '152.0.4', build: 'beta.28', sha256: '8b7680a6' };
const run = (installDir: string, o: { pin?: string; override?: string } = {}) =>
  ensureInstallLayout({ installDir, pinnedBuild: o.pin ?? PIN, installDirOverride: o.override });
const bytesOf = (dir: string) =>
  [
    'version.json',
    'Camoufox.app/Contents/MacOS/camoufox',
    'Camoufox.app/Contents/Resources/properties.json',
  ].map((f) => readFileSync(join(dir, f), 'utf8'));

beforeEach(() => {
  expect.hasAssertions();
});

describe('ensureInstallLayout (decision 69 round 2, item 1; PIE-R2-03)', () => {
  it('with both entries present and correct, nothing is written', () => {
    const f = fakeInstall(BUNDLE);
    symlinkSync(f.app, join(f.installDir, 'Camoufox.app'));
    writeFileSync(
      join(f.installDir, 'version.json'),
      JSON.stringify({ version: '152.0.4', release: 'beta.28' }),
    );
    expect(run(f.installDir)).toEqual({
      installDir: f.installDir,
      bundleDir: f.bundleDir,
      build: PIN,
      ffMajor: 152,
      created: [],
    });
  });
  it('creates the Camoufox.app symlink to the configured bundle and the top-level version.json, leaving the bundle untouched', () => {
    const f = fakeInstall(BUNDLE);
    const before = bytesOf(f.bundleDir);
    expect(run(f.installDir).created).toEqual(['Camoufox.app', 'version.json']);
    const link = join(f.installDir, 'Camoufox.app');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(realpathSync(readlinkSync(link))).toBe(realpathSync(f.app));
    expect(JSON.parse(readFileSync(join(f.installDir, 'version.json'), 'utf8'))).toEqual({
      version: '152.0.4',
      release: 'beta.28',
    });
    expect(bytesOf(f.bundleDir)).toEqual(before);
  });
  it('accepts release where build is absent', () => {
    const f = fakeInstall({ version: '152.0.4', release: 'beta.28' });
    expect(run(f.installDir).build).toBe(PIN);
  });
  it('picks the pinned bundle among several', () => {
    const f = fakeInstall(BUNDLE);
    fakeInstall({ version: '150.0.1', build: 'beta.25' }, { home: f.home, id: '150.0.1-beta.25-aaaa' });
    expect(run(f.installDir).bundleDir).toBe(f.bundleDir);
  });
  it('a top-level version.json that disagrees with the bundle refuses, never rewritten', () => {
    const f = fakeInstall(BUNDLE);
    writeFileSync(
      join(f.installDir, 'version.json'),
      JSON.stringify({ version: '152.0.4', release: 'beta.27' }),
    );
    expect(() => run(f.installDir)).toThrow(/never rewritten silently/);
    expect(JSON.parse(readFileSync(join(f.installDir, 'version.json'), 'utf8')).release).toBe('beta.27');
  });
  it('a top-level version.json on another version refuses', () => {
    const f = fakeInstall(BUNDLE);
    writeFileSync(
      join(f.installDir, 'version.json'),
      JSON.stringify({ version: '151.0.0', release: 'beta.28' }),
    );
    expect(() => run(f.installDir)).toThrow(/disagrees/);
  });
  it('a Camoufox.app symlink to another bundle refuses', () => {
    const f = fakeInstall(BUNDLE);
    const other = fakeInstall(
      { version: '150.0.1', build: 'beta.25' },
      { home: f.home, id: '150.0.1-beta.25-aaaa' },
    );
    symlinkSync(other.app, join(f.installDir, 'Camoufox.app'));
    expect(() => run(f.installDir)).toThrow(/not a symlink to the pinned bundle/);
  });
  it('a Camoufox.app that is a real directory refuses', () => {
    const f = fakeInstall(BUNDLE);
    mkdirSync(join(f.installDir, 'Camoufox.app'));
    expect(() => run(f.installDir)).toThrow(/never rewritten silently/);
  });
  it('CAMOUFOX_INSTALL_DIR set in the environment refuses', () => {
    const f = fakeInstall(BUNDLE);
    expect(() => run(f.installDir, { override: '/elsewhere' })).toThrow(/CAMOUFOX_INSTALL_DIR/);
  });
  it.each([
    ['a non-numeric version', { version: 'x.0', build: 'beta.28' }],
    ['no build or release', { version: '152.0.4' }],
    ['no version', { build: 'beta.28' }],
  ])('the shape check runs before the pin: %s fails naming version.json', (_n, v) => {
    const f = fakeInstall(v);
    expect(() => run(f.installDir)).toThrow(/version\.json/);
  });
  it('a malformed version.json fails naming it', () => {
    const f = fakeInstall(BUNDLE);
    writeFileSync(join(f.bundleDir, 'version.json'), '{not json');
    expect(() => run(f.installDir)).toThrow(/version\.json/);
  });
  it('another build fails naming CAMOUFOX_BINARY_BUILD', () => {
    const f = fakeInstall({ version: '152.0.4', build: 'beta.29' });
    expect(() => run(f.installDir)).toThrow(/CAMOUFOX_BINARY_BUILD/);
  });
  it('no bundle at all refuses', () => {
    const f = fakeInstall(BUNDLE);
    expect(() => run(join(f.home, 'nowhere'))).toThrow(/no Camoufox bundle/);
    mkdirSync(join(f.home, 'empty', 'browsers', 'official'), { recursive: true });
    expect(() => run(join(f.home, 'empty'))).toThrow(/no Camoufox bundle/);
  });
  it('a bundle without its binary refuses', () => {
    const f = fakeInstall(BUNDLE);
    writeFileSync(join(f.bundleDir, 'version.json'), JSON.stringify(BUNDLE));
    rmSync(join(f.app, 'Contents', 'MacOS', 'camoufox'));
    expect(() => run(f.installDir)).toThrow(/MacOS\/camoufox/);
  });
});

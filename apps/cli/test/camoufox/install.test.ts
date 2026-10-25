import { CAMOUFOX_BUILDS, type CamoufoxBuild, FLAGS, OS_ARCHES } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  bundlePath,
  bundleVersionText,
  freeBytesAt,
  installedDigest,
  megabytes,
  osArchOf,
  otherBundles,
  planInstall,
  staleEntries,
  staysOffNote,
} from '../../src/camoufox/install.js';
import { planLayout, topVersionText } from '../../src/camoufox/layout.js';
import {
  APT_LINE,
  DEBIAN_EXTRA,
  libraryProblem,
  linkedFiles,
  missingSonames,
  UBUNTU_LIBRARIES,
  unzipProblem,
} from '../../src/camoufox/libs.js';
import { manifestArgv, manifestFor, parseManifest } from '../../src/camoufox/manifest.js';
import { MemoryFs, memoryRunner } from '../../src/exec/memory.js';

const ROOT = '/Users/op/.local/share/get-me-there/camoufox';
const MAC = CAMOUFOX_BUILDS['darwin-arm64'];
const BUNDLE = `${ROOT}/browsers/official/152.0.4-beta.28-8b7680a6`;
const PLENTY = 10_000_000_000;

const plan = (fs: MemoryFs, o: { entry?: CamoufoxBuild; freeBytes?: number | null } = {}) =>
  planInstall({
    root: ROOT,
    entry: o.entry ?? MAC,
    files: fs,
    freeBytes: o.freeBytes === undefined ? PLENTY : o.freeBytes,
    random: 'abcd1234',
  });

describe('the install planner (Task 17.1; spec §2 "Method"; decision 73)', () => {
  it('picks <os>-<arch> from the platform, and none on Windows', () => {
    expect(osArchOf({ os: 'darwin', arch: 'arm64' })).toBe('darwin-arm64');
    expect(osArchOf({ os: 'darwin', arch: 'x64' })).toBe('darwin-x64');
    expect(osArchOf({ os: 'linux', arch: 'arm64' })).toBe('linux-arm64');
    expect(osArchOf({ os: 'linux', arch: 'x64' })).toBe('linux-x64');
    expect(osArchOf({ os: 'win32', arch: 'x64' })).toBeNull();
  });

  it('downloads, unpacks into a 0700 .tmp-<random>/ under the root, writes version.json and renames into place, for every entry', () => {
    for (const k of OS_ARCHES) {
      const entry = CAMOUFOX_BUILDS[k];
      const p = plan(new MemoryFs(501), { entry });
      if (p.kind !== 'install') throw new Error(k);
      const name = `152.0.4-beta.28-${entry.sha256.slice(0, 8)}`;
      const archive = `${ROOT}/.download-${name}.zip`;
      expect(p.bundle).toBe(`${ROOT}/browsers/official/${name}`);
      expect(p.actions, k).toEqual([
        { kind: 'mkdir', path: ROOT, mode: 0o700 },
        { kind: 'mkdir', path: `${ROOT}/browsers`, mode: 0o700 },
        { kind: 'mkdir', path: `${ROOT}/browsers/official`, mode: 0o700 },
        { kind: 'download', url: entry.url, to: archive, sha256: entry.sha256, bytes: entry.bytes },
        { kind: 'unpack', archive, sha256: entry.sha256, to: `${ROOT}/.tmp-abcd1234` },
        {
          kind: 'writeFile',
          path: `${ROOT}/.tmp-abcd1234/version.json`,
          contents: `${JSON.stringify({ version: '152.0.4', build: 'beta.28', release: 'beta.28', sha256: entry.sha256 })}\n`,
          mode: 0o644,
          secret: false,
        },
        { kind: 'rename', from: `${ROOT}/.tmp-abcd1234`, to: `${ROOT}/browsers/official/${name}` },
        { kind: 'remove', path: archive, recursive: false },
      ]);
    }
  });

  it('makes no directory that is already there at 0700, and tightens one that is not', () => {
    const fs = new MemoryFs(501)
      .dir(ROOT, 0o700)
      .dir(`${ROOT}/browsers`, 0o755)
      .dir(`${ROOT}/browsers/official`, 0o700);
    const p = plan(fs);
    if (p.kind !== 'install') throw new Error('install');
    expect(p.actions.filter((a) => a.kind === 'mkdir')).toEqual([
      { kind: 'mkdir', path: `${ROOT}/browsers`, mode: 0o700 },
    ]);
  });

  it('refuses when the free space is under the archive plus its unpacked size, naming every figure', () => {
    const need = MAC.bytes + MAC.unpackedBytes;
    expect(plan(new MemoryFs(501), { freeBytes: need - 1 })).toEqual({
      kind: 'refused',
      message: `Camoufox needs 983 MB free under ${ROOT} (the 313 MB download and about 670 MB unpacked); 983 MB is free`,
    });
    expect(plan(new MemoryFs(501), { freeBytes: 500_000_000 })).toEqual({
      kind: 'refused',
      message: `Camoufox needs 983 MB free under ${ROOT} (the 313 MB download and about 670 MB unpacked); 500 MB is free`,
    });
    expect(plan(new MemoryFs(501), { freeBytes: need }).kind).toBe('install');
    expect(plan(new MemoryFs(501), { freeBytes: null })).toEqual({
      kind: 'refused',
      message: `could not read the free space under ${ROOT}; Camoufox needs 983 MB (the 313 MB download and about 670 MB unpacked)`,
    });
    expect(megabytes(1_250_000_000)).toBe('1,250 MB');
  });

  it('a bundle already there with the pinned digest plans nothing; any other is reported and never overwritten', () => {
    const same = new MemoryFs(501).file(`${BUNDLE}/version.json`, bundleVersionText(MAC));
    expect(plan(same)).toEqual({ kind: 'installed', bundle: BUNDLE });
    for (const fs of [
      new MemoryFs(501).file(`${BUNDLE}/version.json`, bundleVersionText({ ...MAC, sha256: 'f'.repeat(64) })),
      new MemoryFs(501).dir(BUNDLE),
      new MemoryFs(501).file(`${BUNDLE}/version.json`, 'not json'),
      new MemoryFs(501).dir('/elsewhere').symlink(BUNDLE, '/elsewhere'),
    ]) {
      const p = plan(fs);
      expect(p.kind).toBe('refused');
      expect(p.kind === 'refused' ? p.message : '').toBe(
        `${BUNDLE} is there but is not the pinned Camoufox 152.0.4-beta.28 (its version.json does not name the digest ${MAC.sha256}); it is never overwritten: move it aside, then run pnpm gmt browser install`,
      );
    }
  });

  it('reads an installed digest only from a version.json naming one', () => {
    const fs = new MemoryFs(501)
      .file('/a/version.json', JSON.stringify({ sha256: 'x' }))
      .file('/b/version.json', JSON.stringify({ sha256: 1 }))
      .file('/c/version.json', 'null')
      .file('/d/version.json', '{')
      .unreadable('/e/version.json');
    expect(['/a', '/b', '/c', '/d', '/e', '/f'].map((d) => installedDigest(fs, d))).toEqual([
      'x',
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('lists the bundles other than the one kept', () => {
    const fs = new MemoryFs(501)
      .dir(BUNDLE)
      .dir(`${ROOT}/browsers/official/old-1`)
      .dir(`${ROOT}/browsers/official/old-2`);
    expect(otherBundles(fs, ROOT, BUNDLE)).toEqual([
      `${ROOT}/browsers/official/old-1`,
      `${ROOT}/browsers/official/old-2`,
    ]);
    expect(otherBundles(new MemoryFs(501), ROOT, BUNDLE)).toEqual([]);
  });

  it('reads the free space with df -Pk at the nearest existing directory', async () => {
    const fs = new MemoryFs(501).dir('/Users/op/.local/share');
    const runner = memoryRunner(fs, (argv) =>
      argv[0] === 'df'
        ? {
            code: 0,
            stdout:
              'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s5 100 50 2048 50% /\n',
          }
        : undefined,
    );
    expect(await freeBytesAt(runner, fs, ROOT)).toBe(2048 * 1024);
    expect(runner.calls[0]?.argv).toEqual(['df', '-Pk', '/Users/op/.local/share']);
    expect(
      await freeBytesAt(
        memoryRunner(fs, () => ({ code: 1 })),
        fs,
        ROOT,
      ),
    ).toBeNull();
    expect(
      await freeBytesAt(
        memoryRunner(fs, () => ({ code: 0, stdout: 'odd' })),
        fs,
        ROOT,
      ),
    ).toBeNull();
    expect(
      await freeBytesAt(
        memoryRunner(new MemoryFs(501), () => ({ code: 0, stdout: 'a b c 7' })),
        fs,
        '/x/y',
      ),
    ).toBe(7 * 1024);
  });
});

describe('the layout the CLI owns (Task 17.1)', () => {
  const layout = (fs: MemoryFs, os: 'darwin' | 'linux' = 'darwin') =>
    planLayout({ os, root: ROOT, bundle: BUNDLE, entry: MAC, files: fs, random: 'beef' });

  it('macOS: the root’s Camoufox.app symlink to the bundle and its { version, release } version.json', () => {
    expect(topVersionText(MAC)).toBe('{"version":"152.0.4","release":"beta.28"}');
    expect(layout(new MemoryFs(501))).toEqual({
      kind: 'ok',
      actions: [
        {
          kind: 'run',
          argv: ['ln', '-s', `${BUNDLE}/Camoufox.app`, `${ROOT}/Camoufox.app`],
          cwd: ROOT,
          describe: `link ${ROOT}/Camoufox.app to ${BUNDLE}/Camoufox.app`,
        },
        {
          kind: 'writeFile',
          path: `${ROOT}/version.json`,
          contents: '{"version":"152.0.4","release":"beta.28"}',
          mode: 0o644,
          secret: false,
        },
      ],
    });
  });

  it('an existing layout for the bundle plans nothing; a link to another bundle is switched in one rename', () => {
    const done = new MemoryFs(501)
      .dir(`${BUNDLE}/Camoufox.app`)
      .symlink(`${ROOT}/Camoufox.app`, `${BUNDLE}/Camoufox.app`)
      .file(`${ROOT}/version.json`, topVersionText(MAC));
    expect(layout(done)).toEqual({ kind: 'ok', actions: [] });
    const old = new MemoryFs(501)
      .dir(`${ROOT}/browsers/official/old/Camoufox.app`)
      .symlink(`${ROOT}/Camoufox.app`, `${ROOT}/browsers/official/old/Camoufox.app`)
      .file(`${ROOT}/version.json`, '{"version":"151.0","release":"beta.1"}');
    const r = layout(old);
    expect(
      r.kind === 'ok' ? r.actions.map((a) => (a.kind === 'run' ? a.argv.join(' ') : `${a.kind}`)) : r,
    ).toEqual([`ln -s ${BUNDLE}/Camoufox.app ${ROOT}/.Camoufox.app.tmp-beef`, 'rename', 'writeFile']);
    expect(r.kind === 'ok' ? r.actions[1] : null).toEqual({
      kind: 'rename',
      from: `${ROOT}/.Camoufox.app.tmp-beef`,
      to: `${ROOT}/Camoufox.app`,
    });
  });

  it('a real directory or file where the link belongs is refused, never replaced', () => {
    for (const fs of [
      new MemoryFs(501).dir(`${ROOT}/Camoufox.app`),
      new MemoryFs(501).file(`${ROOT}/Camoufox.app`, 'x'),
    ])
      expect(layout(fs)).toEqual({
        kind: 'refused',
        message: `${ROOT}/Camoufox.app is not a symlink to a Camoufox bundle; it is never replaced: move it aside, then run pnpm gmt browser install`,
      });
  });

  it('an unreadable top-level version.json is rewritten', () => {
    const fs = new MemoryFs(501)
      .dir(`${BUNDLE}/Camoufox.app`)
      .symlink(`${ROOT}/Camoufox.app`, `${BUNDLE}/Camoufox.app`)
      .file(`${ROOT}/version.json`, 'x')
      .unreadable(`${ROOT}/version.json`);
    const r = layout(fs);
    expect(r.kind === 'ok' ? r.actions.map((a) => a.kind) : r).toEqual(['writeFile']);
  });

  it('Linux: nothing beyond the bundle, which is the install directory itself', () => {
    expect(layout(new MemoryFs(501), 'linux')).toEqual({ kind: 'ok', actions: [] });
  });
});

describe('the host checks (Task 17.1; WP17 §0)', () => {
  const ENV = { PATH: '/usr/bin:/bin', HOME: '/home/op' };
  const LIN = '/home/op/.local/share/get-me-there/camoufox/browsers/official/152.0.4-beta.28-924f3109';
  const linuxBundle = () =>
    new MemoryFs(501)
      .file(`${LIN}/camoufox-bin`, 'ELF', 0o755)
      .file(`${LIN}/libxul.so`, 'ELF')
      .file(`${LIN}/libmozgtk.so`, 'ELF')
      .file(`${LIN}/gmp-clearkey/0.1/libclearkey.so`, 'ELF')
      .file(`${LIN}/libfoo.so.1.2`, 'ELF')
      .file(`${LIN}/omni.ja`, 'PK')
      .file(`${LIN}/properties.json`, '{}')
      .symlink(`${LIN}/libloop.so`, `${LIN}/libxul.so`);

  it('ldd runs over camoufox-bin and every .so in the bundle, subdirectories included, links skipped', async () => {
    const fs = linuxBundle();
    expect(linkedFiles(fs, LIN)).toEqual([
      `${LIN}/camoufox-bin`,
      `${LIN}/gmp-clearkey/0.1/libclearkey.so`,
      `${LIN}/libfoo.so.1.2`,
      `${LIN}/libmozgtk.so`,
      `${LIN}/libxul.so`,
    ]);
    const runner = memoryRunner(fs, () => ({ code: 0, stdout: '\tlibc.so.6 => /lib/libc.so.6 (0x1)\n' }));
    expect(await libraryProblem(runner, fs, LIN, ENV)).toBeNull();
    expect(runner.calls.map((c) => c.argv)).toEqual(linkedFiles(fs, LIN).map((f) => ['ldd', f]));
  });

  it('ldd runs with LD_LIBRARY_PATH naming the bundle and its library directories, so the bundle’s own libraries resolve (W4)', async () => {
    const fs = linuxBundle();
    // why: as ldd does: libxul.so finds libmozgtk.so only when LD_LIBRARY_PATH names the bundle
    const runner = memoryRunner(fs, (argv, call) => {
      if (argv[1]?.endsWith('/libxul.so') !== true) return { code: 0, stdout: '' };
      const dirs = (call.env?.LD_LIBRARY_PATH ?? '').split(':');
      return {
        code: 0,
        stdout: `\tlibmozgtk.so => ${dirs.includes(LIN) ? `${LIN}/libmozgtk.so` : 'not found'}\n\tlibgtk-3.so.0 => /lib/libgtk-3.so.0\n`,
      };
    });
    expect(await libraryProblem(runner, fs, LIN, ENV)).toBeNull();
    for (const c of runner.calls)
      expect(c.env).toEqual({ ...ENV, LD_LIBRARY_PATH: `${LIN}:${LIN}/gmp-clearkey/0.1` });
    // and a host library the bundle does not ship still refuses
    const host = memoryRunner(fs, (argv) =>
      argv[1]?.endsWith('/libxul.so') === true
        ? { code: 0, stdout: '\tlibgtk-3.so.0 => not found\n' }
        : { code: 0, stdout: '' },
    );
    expect(await libraryProblem(host, fs, LIN, ENV)).toMatch(/missing on this machine \(libgtk-3\.so\.0\)/);
  });

  it('only libxul.so reporting libgtk-3.so.0 => not found refuses, naming the missing sonames and the apt line', async () => {
    const fs = linuxBundle();
    const runner = memoryRunner(fs, (argv) =>
      argv[1]?.endsWith('/libxul.so') === true
        ? {
            code: 0,
            stdout:
              '\tlibgtk-3.so.0 => not found\n\tlibasound.so.2 => not found\n\tlibgtk-3.so.0 => not found\n\tlibc.so.6 => /lib/libc.so.6\n',
          }
        : { code: 0, stdout: '\tlibc.so.6 => /lib/libc.so.6\n' },
    );
    expect(await libraryProblem(runner, fs, LIN, ENV)).toBe(
      `Firefox’s libraries are missing on this machine (libasound.so.2, libgtk-3.so.0). On Ubuntu 24.04 install them with: ${APT_LINE} (Debian 12 also needs libdbus-glib-1-2 libharfbuzz0b libxtst6), then run pnpm gmt browser install`,
    );
    expect(APT_LINE).toBe(`sudo apt-get install ${UBUNTU_LIBRARIES.join(' ')}`);
    expect(UBUNTU_LIBRARIES).toHaveLength(25);
    expect(DEBIAN_EXTRA).toEqual(['libdbus-glib-1-2', 'libharfbuzz0b', 'libxtst6']);
  });

  it('a bundle without camoufox-bin, or a machine without ldd, refuses with its own words', async () => {
    const fs = new MemoryFs(501).file(`${LIN}/libxul.so`, 'ELF');
    expect(await libraryProblem(memoryRunner(fs), fs, LIN, ENV)).toBe(
      `${LIN} has no camoufox-bin to check; move it aside, then run pnpm gmt browser install`,
    );
    const full = linuxBundle();
    expect(
      await libraryProblem(
        memoryRunner(full, () => ({ code: 127 })),
        full,
        LIN,
        ENV,
      ),
    ).toBe('ldd is not installed, so Firefox’s libraries cannot be checked: sudo apt-get install libc-bin');
  });

  it('missingSonames reads only "=> not found" lines', () => {
    expect(
      missingSonames([
        'a.so => not found',
        '  b.so => not found  ',
        'c.so => /x',
        'not found',
        'd => not found x',
      ]),
    ).toEqual(['a.so', 'b.so']);
  });

  it('unzip missing names its install line for the system; present, nothing', async () => {
    const fs = new MemoryFs(501);
    expect(
      await unzipProblem(
        memoryRunner(fs, () => ({ code: 127 })),
        'linux',
      ),
    ).toBe(
      'unzip is not installed, and the browser provider needs it: sudo apt-get install unzip (or your distribution’s unzip package)',
    );
    expect(
      await unzipProblem(
        memoryRunner(fs, () => ({ code: 127 })),
        'darwin',
      ),
    ).toBe(
      'unzip is not installed, and the browser provider needs it: macOS ships unzip in /usr/bin; restore it with xcode-select --install',
    );
    const ok = memoryRunner(fs, () => ({ code: 0 }));
    expect(await unzipProblem(ok, 'linux')).toBeNull();
    expect(ok.calls[0]?.argv).toEqual(['unzip', '-v']);
    expect(
      await unzipProblem(
        memoryRunner(fs, () => ({ code: 1 })),
        'linux',
      ),
    ).toBeNull();
  });
});

describe('the manifest update reads from the new code (Task 17.1)', () => {
  it('is the entry and its flags, read through one strict schema', () => {
    const m = manifestFor('darwin-arm64');
    expect(m.entry).toEqual(MAC);
    expect(m.flags.FORM_VERIFIED).toBe(true);
    expect(manifestFor('linux-x64').flags.FORM_VERIFIED).toBe(false);
    expect(parseManifest(JSON.stringify(m))).toEqual(m);
    expect(parseManifest(JSON.stringify({ ...m, extra: 1 }))).toBeNull();
    expect(
      parseManifest(JSON.stringify({ ...m, entry: { ...m.entry, url: 'https://elsewhere.example/x.zip' } })),
    ).toBeNull();
    expect(parseManifest('{')).toBeNull();
    expect(manifestArgv('/opt/node/bin/node', '/repo', 'linux-arm64')).toEqual([
      '/opt/node/bin/node',
      '--conditions=@gmt/source',
      '--import',
      'tsx',
      '/repo/apps/cli/src/camoufox/printManifest.ts',
      'linux-arm64',
    ]);
    expect(manifestArgv('/n', '/repo', 'linux-arm64', '/s/update-pin-ab.ts').slice(-3)).toEqual([
      'linux-arm64',
      '--pin',
      '/s/update-pin-ab.ts',
    ]);
    // why: W6: any validated pin's manifest, its flags read on its own build
    expect(
      manifestFor('linux-x64', {
        builds: CAMOUFOX_BUILDS,
        flags: { ...FLAGS, 'linux-x64': FLAGS['darwin-arm64'] },
      }).flags.FORM_VERIFIED,
    ).toBe(true);
  });
});

describe('what an earlier attempt left, and a kept archive (W6)', () => {
  // why: dev-b1-005, sec-b1-001: an interrupted install leaves gigabytes under hidden names; any later run sweeps them
  it('every install first removes the unpack’s and the layout’s temporary names, a partial download and other pins’ archives', () => {
    const name = '152.0.4-beta.28-8b7680a6';
    const fs = new MemoryFs(501)
      .dir(`${ROOT}/.tmp-0badf00d/inner`)
      .dir(`${ROOT}/..tmp-0badf00d.tmp-1-ab`)
      .file(`${ROOT}/.Camoufox.app.tmp-beef`, '')
      .file(`${ROOT}/.version.json.tmp-9-cd`, '')
      .file(`${ROOT}/.download-${name}.zip.part`, 'half')
      .file(`${ROOT}/.download-152.0.4-beta.27-aaaaaaaa.zip`, 'old')
      .file(`${ROOT}/version.json`, '{}')
      .dir(`${ROOT}/browsers`);
    expect(staleEntries(fs, ROOT, MAC).sort()).toEqual(
      [
        `${ROOT}/..tmp-0badf00d.tmp-1-ab`,
        `${ROOT}/.Camoufox.app.tmp-beef`,
        `${ROOT}/.download-152.0.4-beta.27-aaaaaaaa.zip`,
        `${ROOT}/.download-${name}.zip.part`,
        `${ROOT}/.tmp-0badf00d`,
        `${ROOT}/.version.json.tmp-9-cd`,
      ].sort(),
    );
    const p = plan(fs);
    if (p.kind !== 'install') throw new Error(p.kind);
    expect(p.actions.filter((a) => a.kind === 'remove' && a.recursive).length).toBe(6);
    expect(p.actions.findIndex((a) => a.kind === 'download')).toBeGreaterThan(5);
  });
  it('the pinned archive already whole is not fetched again (the unpack re-hashes it); one of another size is', () => {
    const archive = `${ROOT}/.download-152.0.4-beta.28-8b7680a6.zip`;
    const whole = new MemoryFs(501).file(archive, 'x'.repeat(MAC.bytes > 1000 ? 10 : 10));
    const sized = { ...MAC, bytes: 10 };
    const p = planInstall({ root: ROOT, entry: sized, files: whole, freeBytes: PLENTY, random: 'abcd1234' });
    if (p.kind !== 'install') throw new Error(p.kind);
    expect(p.actions.map((a) => a.kind)).not.toContain('download');
    expect(p.actions.find((a) => a.kind === 'unpack')).toMatchObject({ archive });
    expect(staleEntries(whole, ROOT, sized)).toEqual([]);
    const partial = new MemoryFs(501).file(archive, 'x'.repeat(9));
    const q = planInstall({
      root: ROOT,
      entry: sized,
      files: partial,
      freeBytes: PLENTY,
      random: 'abcd1234',
    });
    expect(q.kind === 'install' && q.actions.map((a) => a.kind)).toContain('download');
  });
  it('--keep-archive keeps the verified download; otherwise it is removed once unpacked', () => {
    const kept = planInstall({
      root: ROOT,
      entry: MAC,
      files: new MemoryFs(501),
      freeBytes: PLENTY,
      random: 'abcd1234',
      keepArchive: true,
    });
    if (kept.kind !== 'install') throw new Error(kept.kind);
    expect(kept.actions.at(-1)?.kind).toBe('rename');
    const plain = plan(new MemoryFs(501));
    expect(plain.kind === 'install' && plain.actions.at(-1)).toMatchObject({
      kind: 'remove',
      recursive: false,
    });
  });
  it('the update’s words when the new pin has no recordings for this machine', () => {
    expect(staysOffNote('linux-x64', '152.0.4-beta.28')).toBe(
      'the browser provider stays off on linux-x64 until recordings for 152.0.4-beta.28 land; the installed Camoufox is kept',
    );
  });
  it('bundlePath names the build and the digest’s first 8 hex characters', () => {
    expect(bundlePath(ROOT, MAC)).toBe(BUNDLE);
  });
});

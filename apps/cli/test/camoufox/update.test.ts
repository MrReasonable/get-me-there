import { CAMOUFOX_BUILDS } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { bundleVersionText } from '../../src/camoufox/install.js';
import { topVersionText } from '../../src/camoufox/layout.js';
import type { Manifest } from '../../src/camoufox/manifest.js';
import { manifestFor } from '../../src/camoufox/manifest.js';
import { runCli } from '../../src/cli.js';
import { systemExecutor } from '../../src/exec/system.js';
import type { Action } from '../../src/plan/action.js';
import { stubHttp } from '../support/deps.js';
import { machine } from '../support/machine.js';

// why: Task 17.1: update's Camoufox step, placed after the build and before the restart (spec §13; decision 73)
const ROOT = '/Users/op/.local/share/get-me-there/camoufox';
const MAC = CAMOUFOX_BUILDS['darwin-arm64'];
const OLD = `${ROOT}/browsers/official/152.0.4-beta.28-8b7680a6`;
const NEW = { ...MAC, build: '153.0.1-beta.30', sha256: 'c'.repeat(64) };
const NEW_BUNDLE = `${ROOT}/browsers/official/153.0.1-beta.30-cccccccc`;
const flagsOn = manifestFor('darwin-arm64').flags;
const flagsOff = manifestFor('linux-x64').flags;

async function world(o: { manifest: Manifest | string; healthy?: boolean; camoufox?: boolean }) {
  let started = false;
  let head = 'aaaa1111';
  let healthy = true;
  const fetches: string[] = [];
  const http = stubHttp({
    'GET /api/executions/active': () => ({ status: 200, body: { execution: null } }),
    'GET /api/health': () =>
      healthy ? { status: 200, body: { ok: true, degraded: false } } : { status: 503, body: { ok: false } },
  });
  const m = machine({
    http,
    extra: (argv) => {
      if (!started) return undefined;
      if (argv[0] === 'git') {
        if (argv[1] === 'status') return { code: 0, stdout: '' };
        if (argv[1] === 'symbolic-ref') return { code: 0, stdout: 'main\n' };
        if (argv[1] === 'rev-parse')
          return { code: 0, stdout: `${argv[2] === 'HEAD' ? head : 'bbbb2222'}\n` };
        if (argv[1] === 'merge') head = 'bbbb2222';
        return { code: 0 };
      }
      if (argv.some((a) => a.endsWith('backup.mjs')))
        return {
          code: 0,
          stdout: `${JSON.stringify({ ok: true, file: '/Users/op/.local/share/get-me-there/backups/update/get-me-there-2026-10-24T09-30-00-000Z.db' })}\n`,
        };
      if (argv.some((a) => a.endsWith('printManifest.ts')))
        return { code: 0, stdout: typeof o.manifest === 'string' ? o.manifest : JSON.stringify(o.manifest) };
      if (argv[0] === 'df') return { code: 0, stdout: 'h\n/dev/disk 1 1 99999999 1% /\n' };
      if (argv[0] === 'ln') {
        const link = argv[3] ?? '';
        m.fs.symlink(link, argv[2] ?? '');
        return { code: 0 };
      }
      return undefined;
    },
  });
  m.fs.file('/work/a.json', '{}', 0o600);
  expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
  if (o.camoufox !== false)
    m.fs
      .file(`${OLD}/version.json`, bundleVersionText(MAC))
      .dir(`${OLD}/Camoufox.app`)
      .symlink(`${ROOT}/Camoufox.app`, `${OLD}/Camoufox.app`)
      .file(`${ROOT}/version.json`, topVersionText(MAC));
  // why: a download reaches a real executor whose fetch only records, so the test can prove none happened
  const download = systemExecutor(m.runner, {
    fetch: async (u) => {
      fetches.push(String(u));
      return new Response(null, { status: 404 });
    },
  });
  const inner = m.deps.executor;
  m.deps.executor = {
    run: async (a: Action) => {
      if (a.kind === 'download') {
        await download.run(a).catch(() => undefined);
        m.fs.file(a.to, 'zip', 0o600);
      }
      if (a.kind === 'waitHealthy' && !healthy) throw new Error(`${a.url} did not answer healthy`);
      const out = await inner.run(a);
      // why: the memory tree's unpack makes an empty directory; the macOS asset holds Camoufox.app
      if (a.kind === 'unpack') m.fs.dir(`${a.to}/Camoufox.app`);
      return out;
    },
  };
  m.executor.log.length = 0;
  m.runner.calls.length = 0;
  m.io.stdout = '';
  m.io.stderr = '';
  started = true;
  healthy = o.healthy ?? true;
  return { ...m, fetches };
}
const kinds = (log: readonly Action[]) => log.map((a) => (a.kind === 'remove' ? `remove ${a.path}` : a.kind));

describe('update’s Camoufox step (Task 17.1)', () => {
  it('a changed entry whose flags are set is installed after the build, and the previous bundle removed only after the health wait', async () => {
    const m = await world({ manifest: { entry: NEW, flags: flagsOn } });
    expect(await runCli(['update'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain(
      'installing Camoufox 153.0.1-beta.30 for darwin-arm64; the previous bundle is removed once the app is healthy\n',
    );
    const log = kinds(m.executor.log);
    const build = m.executor.log.findIndex((a) => a.kind === 'run' && a.argv.join(' ') === 'pnpm build');
    const download = log.indexOf('download');
    const health = log.indexOf('waitHealthy');
    const removal = log.indexOf(`remove ${OLD}`);
    expect(build).toBeGreaterThan(-1);
    expect(download).toBeGreaterThan(build);
    expect(health).toBeGreaterThan(download);
    expect(removal).toBeGreaterThan(health);
    expect(m.fs.read(`${NEW_BUNDLE}/version.json`)).toBe(bundleVersionText(NEW));
    expect(m.fs.realpath(`${ROOT}/Camoufox.app`)).toBe(`${NEW_BUNDLE}/Camoufox.app`);
    expect(m.fs.read(`${ROOT}/version.json`)).toBe('{"version":"153.0.1","release":"beta.30"}');
    expect(m.fs.isDir(OLD)).toBe(false);
    const read = m.runner.calls.find((c) => c.argv.some((a) => a.endsWith('printManifest.ts')));
    expect(read?.argv).toEqual([
      '/opt/node/bin/node',
      '--conditions=@gmt/source',
      '--import',
      'tsx',
      '/repo/apps/cli/src/printManifest.ts',
      'darwin-arm64',
    ]);
    expect(read?.cwd).toBe('/repo/apps/cli');
  });

  it('when the health wait fails, the previous bundle is kept', async () => {
    const m = await world({ manifest: { entry: NEW, flags: flagsOn }, healthy: false });
    expect(await runCli(['update'], m.deps)).toBe(1);
    expect(m.fs.isDir(OLD)).toBe(true);
    expect(kinds(m.executor.log)).not.toContain(`remove ${OLD}`);
  });

  it('a changed entry without flags installs nothing, keeps the old bundle and says so: no download, no fetch', async () => {
    const m = await world({ manifest: { entry: NEW, flags: flagsOff } });
    expect(await runCli(['update'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain(
      'the browser provider stays off on darwin-arm64 until recordings for 153.0.1-beta.30 land; the installed Camoufox is kept\n',
    );
    expect(kinds(m.executor.log)).not.toContain('download');
    expect(m.fetches).toEqual([]);
    expect(m.fs.isDir(OLD)).toBe(true);
    expect(m.fs.realpath(`${ROOT}/Camoufox.app`)).toBe(`${OLD}/Camoufox.app`);
  });

  it('with no Camoufox installed, update reads no pin and installs nothing', async () => {
    const m = await world({ manifest: { entry: NEW, flags: flagsOn }, camoufox: false });
    expect(await runCli(['update'], m.deps)).toBe(0);
    expect(m.runner.calls.some((c) => c.argv.some((a) => a.endsWith('printManifest.ts')))).toBe(false);
    expect(kinds(m.executor.log)).not.toContain('download');
  });

  it('a pin the new code cannot print stops the update with the recovery report', async () => {
    const m = await world({ manifest: 'not json' });
    expect(await runCli(['update'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain(
      'the new code’s Camoufox pin could not be read\nupdate stopped at the browser install',
    );
    expect(kinds(m.executor.log)).not.toContain('waitHealthy');
  });

  it('the pin unchanged changes nothing in the browser install', async () => {
    const m = await world({ manifest: { entry: MAC, flags: flagsOn } });
    expect(await runCli(['update'], m.deps)).toBe(0);
    expect(kinds(m.executor.log)).not.toContain('download');
    expect(m.fs.isDir(OLD)).toBe(true);
  });

  it('--dry-run names the step without reading the pin', async () => {
    const m = await world({ manifest: { entry: NEW, flags: flagsOn } });
    expect(await runCli(['update', '--dry-run'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain(
      'update: the browser install\n  then: read the new code’s Camoufox pin, and install it only when its recordings set its flags\n',
    );
    expect(m.runner.calls.some((c) => c.argv.some((a) => a.endsWith('printManifest.ts')))).toBe(false);
  });
});

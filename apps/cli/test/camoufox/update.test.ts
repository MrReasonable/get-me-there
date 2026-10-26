import { CAMOUFOX_BUILDS } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { bundleVersionText } from '../../src/camoufox/install.js';
import { topVersionText } from '../../src/camoufox/layout.js';
import type { Manifest } from '../../src/camoufox/manifest.js';
import { manifestFor } from '../../src/camoufox/manifest.js';
import { DRY_RUN_LINE } from '../../src/camoufox/updateStep.js';
import { runCli } from '../../src/cli.js';
import { systemExecutor } from '../../src/exec/system.js';
import type { Action } from '../../src/plan/action.js';
import { stubHttp, unsetFlags } from '../support/deps.js';
import { machine } from '../support/machine.js';

// why: Task 17.1: update's Camoufox step, placed after the build and before the restart (spec §13; decision 73)
const ROOT = '/Users/op/.local/share/get-me-there/camoufox';
const MAC = CAMOUFOX_BUILDS['darwin-arm64'];
const OLD = `${ROOT}/browsers/official/152.0.4-beta.28-8b7680a6`;
const NEW = { ...MAC, build: '153.0.1-beta.30', sha256: 'c'.repeat(64) };
const NEW_BUNDLE = `${ROOT}/browsers/official/153.0.1-beta.30-cccccccc`;
const flagsOn = manifestFor('darwin-arm64').flags;
// why: WP17 Task 17.8 recorded every entry on the pinned build; a new build's entry has no flags yet
const flagsOff = unsetFlags();

async function world(o: {
  manifest: Manifest | string;
  /** What the next commit's pin.ts reads as before the stop (its own printer, `--pin`); null: git show fails. */
  next?: Manifest | string | null;
  healthy?: boolean;
  camoufox?: boolean;
  enabled?: boolean;
  /** Downloads fail (a network problem) while true. */
  downloadsFail?: () => boolean;
  /** The new code's printer's exit (0 by default). */
  printerCode?: number;
}) {
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
        if (argv[1] === 'show') {
          const next = o.next === undefined ? o.manifest : o.next;
          return next === null
            ? { code: 128, stderr: 'fatal: path not in origin/main' }
            : { code: 0, stdout: 'export const CAMOUFOX_PIN = {};\n' };
        }
        return { code: 0 };
      }
      if (argv.some((a) => a.endsWith('printManifest.ts')) && argv.includes('--pin')) {
        const next = o.next === undefined ? o.manifest : o.next;
        return { code: 0, stdout: typeof next === 'string' ? next : JSON.stringify(next) };
      }
      if (argv.some((a) => a.endsWith('backup.mjs')))
        return {
          code: 0,
          stdout: `${JSON.stringify({ ok: true, file: '/Users/op/.local/share/get-me-there/backups/update/get-me-there-2026-10-24T09-30-00-000Z.db' })}\n`,
        };
      if (argv.some((a) => a.endsWith('printManifest.ts')))
        return {
          code: o.printerCode ?? 0,
          stdout: typeof o.manifest === 'string' ? o.manifest : JSON.stringify(o.manifest),
        };
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
  if (o.enabled === true) {
    const env = '/Users/op/.config/get-me-there/app.env';
    m.fs.file(
      env,
      `${m.fs.read(env) ?? ''}CAMOUFOX_ENABLED="true"\nCAMOUFOX_WORKER_URL="http://127.0.0.1:8090"\nCAMOUFOX_WORKER_KEY="${'k'.repeat(48)}"\n`,
      0o600,
    );
  }
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
        if (o.downloadsFail?.() === true) throw new Error(`download of ${a.url} answered 503`);
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

const stopAt = (log: readonly Action[]) =>
  log.findIndex((a) => a.kind === 'run' && a.argv[0] === 'launchctl' && a.argv[1] === 'bootout');

describe('update’s Camoufox step (Task 17.1; W6)', () => {
  // why: W6 (dev-b1-006): the network work is done while the app runs; only the switch happens while it is stopped
  it('a changed entry whose flags are set is downloaded before the app stops, switched after the build, the previous bundle removed after the health wait', async () => {
    const m = await world({ manifest: { entry: NEW, flags: flagsOn } });
    expect(await runCli(['update'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain(
      'Downloading Camoufox 153.0.1-beta.30 for darwin-arm64 (313 MB) from github.com',
    );
    const log = kinds(m.executor.log);
    const build = m.executor.log.findIndex((a) => a.kind === 'run' && a.argv.join(' ') === 'pnpm build');
    const download = log.indexOf('download');
    const stop = stopAt(m.executor.log);
    const link = m.executor.log.findIndex((a) => a.kind === 'run' && a.argv[0] === 'ln');
    const health = log.indexOf('waitHealthy');
    const removal = log.indexOf(`remove ${OLD}`);
    expect(download).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(download);
    expect(build).toBeGreaterThan(stop);
    expect(link).toBeGreaterThan(build);
    expect(health).toBeGreaterThan(link);
    expect(removal).toBeGreaterThan(health);
    expect(log.filter((k) => k === 'download')).toHaveLength(1);
    expect(m.fs.read(`${NEW_BUNDLE}/version.json`)).toBe(bundleVersionText(NEW));
    expect(m.fs.realpath(`${ROOT}/Camoufox.app`)).toBe(`${NEW_BUNDLE}/Camoufox.app`);
    expect(m.fs.read(`${ROOT}/version.json`)).toBe('{"version":"153.0.1","release":"beta.30"}');
    expect(m.fs.isDir(OLD)).toBe(false);
    const reads = m.runner.calls.filter((c) => c.argv.some((a) => a.endsWith('printManifest.ts')));
    expect(reads.map((c) => c.argv.slice(4))).toEqual([
      [
        '/repo/apps/cli/src/camoufox/printManifest.ts',
        'darwin-arm64',
        '--pin',
        expect.stringMatching(/update-pin-[0-9a-f]+\.ts$/),
      ],
      ['/repo/apps/cli/src/camoufox/printManifest.ts', 'darwin-arm64'],
    ]);
    expect(reads.every((c) => c.cwd === '/repo/apps/cli')).toBe(true);
    const show = m.runner.calls.find((c) => c.argv[0] === 'git' && c.argv[1] === 'show');
    expect(show?.argv).toEqual(['git', 'show', 'origin/main:packages/core/src/camoufox/pin.ts']);
    // why: the next pin's copy is read from a file of its own, removed once read
    const pinFile = String(reads[0]?.argv.at(-1));
    expect(m.fs.read(pinFile)).toBeNull();
  });

  it('a download that fails before the stop is said and tried again after the build; the app is never down for it twice', async () => {
    let fail = true;
    const m = await world({ manifest: { entry: NEW, flags: flagsOn }, downloadsFail: () => fail });
    const inner = m.deps.executor;
    m.deps.executor = {
      run: async (a: Action) => {
        if (a.kind === 'run' && a.argv.join(' ') === 'pnpm build') fail = false;
        return inner.run(a);
      },
    };
    expect(await runCli(['update'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain('the browser install runs after the build instead');
    expect(m.io.stdout.match(/Downloading Camoufox 153\.0\.1-beta\.30/g)).toHaveLength(2);
    expect(kinds(m.executor.log).indexOf('download')).toBeGreaterThan(stopAt(m.executor.log));
    expect(m.fs.realpath(`${ROOT}/Camoufox.app`)).toBe(`${NEW_BUNDLE}/Camoufox.app`);
  });

  it('a next pin that cannot be read before the stop is said, and the install runs after the build', async () => {
    for (const next of [null, 'garbled']) {
      const m = await world({ manifest: { entry: NEW, flags: flagsOn }, next });
      expect(await runCli(['update'], m.deps)).toBe(0);
      expect(m.io.stdout).toMatch(
        /the next commit’s Camoufox pin (could not be read|is not one this code reads); the browser install runs after the build instead/,
      );
      const log = kinds(m.executor.log);
      expect(log.indexOf('download')).toBeGreaterThan(stopAt(m.executor.log));
    }
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

  it('with no Camoufox installed and the provider off, update installs nothing, and says when the new code offers the provider here', async () => {
    const on = await world({ manifest: { entry: NEW, flags: flagsOn }, camoufox: false });
    expect(await runCli(['update'], on.deps)).toBe(0);
    expect(kinds(on.executor.log)).not.toContain('download');
    expect(on.io.stdout).toContain(
      'The browser provider is now available on darwin-arm64: turn it on with pnpm gmt setup --reconfigure browser\n',
    );
    const off = await world({ manifest: { entry: NEW, flags: flagsOff }, camoufox: false });
    expect(await runCli(['update'], off.deps)).toBe(0);
    expect(off.io.stdout).not.toContain('now available');
    const unreadable = await world({ manifest: 'garbled', camoufox: false });
    expect(await runCli(['update'], unreadable.deps)).toBe(0);
  });

  // why: po-b1-002: with the provider on but no bundle (removed, or never installed), update installs it
  it('with the provider on and no bundle, update installs the pin and never says it is newly available', async () => {
    const m = await world({ manifest: { entry: MAC, flags: flagsOn }, camoufox: false, enabled: true });
    // why: the closing status reads the worker, which this stand-in machine does not run; the update itself succeeded
    await runCli(['update'], m.deps);
    expect(m.io.stderr).toBe('');
    expect(m.io.stdout).toContain('updated aaaa1111 to bbbb2222');
    expect(m.io.stdout).not.toContain('now available');
    expect(m.fs.read(`${OLD}/version.json`)).toBe(bundleVersionText(MAC));
  });

  // why: CodeRabbit (PR #15), dev-b1-006: the browser is optional; its failure never keeps the app down
  it('a pin the new code cannot print: the app starts again without the worker, and the update reports the failure', async () => {
    const m = await world({ manifest: 'not json', next: { entry: MAC, flags: flagsOn } });
    expect(await runCli(['update'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain(
      'the new code’s Camoufox pin could not be read\nThe app starts again without the browser worker; pnpm gmt browser install retries the install.\n',
    );
    expect(m.io.stderr).toContain('but not the browser install: run pnpm gmt browser install');
    expect(kinds(m.executor.log)).toContain('waitHealthy');
  });

  // why: W6 (dev-b1-004): any later successful run removes what an earlier pin left
  it('the pin unchanged downloads nothing, and removes a bundle an earlier pin left once the app is healthy', async () => {
    const m = await world({ manifest: { entry: MAC, flags: flagsOn } });
    const stale = `${ROOT}/browsers/official/152.0.4-beta.27-aaaaaaaa`;
    m.fs.file(`${stale}/version.json`, '{}');
    expect(await runCli(['update'], m.deps)).toBe(0);
    const log = kinds(m.executor.log);
    expect(log).not.toContain('download');
    expect(m.fs.isDir(OLD)).toBe(true);
    expect(log.indexOf(`remove ${stale}`)).toBeGreaterThan(log.indexOf('waitHealthy'));
    expect(m.fs.isDir(stale)).toBe(false);
  });

  // why: ts-b1-003: the next pin is read from a private file of its own, gone afterwards, by this code's printer
  it('the next pin goes to a 0600 file under the state directory, read with --pin, then removed', async () => {
    const m = await world({ manifest: { entry: NEW, flags: flagsOn } });
    expect(await runCli(['update'], m.deps)).toBe(0);
    const write = m.executor.log.find((a) => a.kind === 'writeFile' && a.path.includes('update-pin-'));
    expect(write).toMatchObject({
      kind: 'writeFile',
      contents: 'export const CAMOUFOX_PIN = {};\n',
      mode: 0o600,
      secret: false,
    });
    const path = write?.kind === 'writeFile' ? write.path : '';
    expect(path).toMatch(/^\/Users\/op\/\.local\/state\/get-me-there\/update-pin-[0-9a-f]{8}\.ts$/);
    const read = m.runner.calls.find((c) => c.argv.includes('--pin'));
    expect(read?.argv.slice(-3)).toEqual(['darwin-arm64', '--pin', path]);
    expect(read?.cwd).toBe('/repo/apps/cli');
    expect(kinds(m.executor.log)).toContain(`remove ${path}`);
    expect(m.fs.read(path)).toBeNull();
    expect(m.io.stdout).not.toContain('instead');
  });

  it('a pin file that cannot be written is said, nothing is read with it, and the install runs after the build', async () => {
    const m = await world({ manifest: { entry: NEW, flags: flagsOn } });
    const inner = m.deps.executor;
    m.deps.executor = {
      run: async (a: Action) => {
        if (a.kind === 'writeFile' && a.path.includes('update-pin-')) throw new Error('EACCES');
        return inner.run(a);
      },
    };
    expect(await runCli(['update'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain(
      'the next commit’s Camoufox pin is not one this code reads; the browser install runs after the build instead',
    );
    expect(m.runner.calls.some((c) => c.argv.includes('--pin'))).toBe(false);
    expect(kinds(m.executor.log).indexOf('download')).toBeGreaterThan(stopAt(m.executor.log));
  });

  it('a printer that exits non-zero is no manifest, whatever it printed', async () => {
    const m = await world({ manifest: { entry: MAC, flags: flagsOn }, printerCode: 1 });
    expect(await runCli(['update'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain('the new code’s Camoufox pin could not be read');
  });

  it('a download that fails before the stop names its step', async () => {
    let fail = true;
    const m = await world({ manifest: { entry: NEW, flags: flagsOn }, downloadsFail: () => fail });
    const inner = m.deps.executor;
    m.deps.executor = {
      run: async (a: Action) => {
        if (a.kind === 'run' && a.argv.join(' ') === 'pnpm build') fail = false;
        return inner.run(a);
      },
    };
    expect(await runCli(['update'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain('update: download Camoufox: stopped at a failed step');
  });

  it('nothing to do for the browser leaves nothing for after the health wait', async () => {
    for (const o of [
      { manifest: { entry: NEW, flags: flagsOff } },
      { manifest: { entry: NEW, flags: flagsOn }, camoufox: false },
    ]) {
      const m = await world(o);
      expect(await runCli(['update'], m.deps)).toBe(0);
      const log = m.executor.log;
      const wait = log.findIndex((a) => a.kind === 'waitHealthy');
      // why: update's own record of the run is the one removal after the wait; no bundle removal follows
      expect(kinds(log.slice(wait + 1))).toEqual(['remove /Users/op/.local/state/get-me-there/update.json']);
    }
  });

  it('--dry-run names the step without reading the pin', async () => {
    expect(DRY_RUN_LINE).toBe(
      'update: the browser install\n  then: download the next pin before the stop when its recordings set its flags, switch to it after the build, and remove older bundles once the app is healthy\n',
    );
    const m = await world({ manifest: { entry: NEW, flags: flagsOn } });
    expect(await runCli(['update', '--dry-run'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain(DRY_RUN_LINE);
    expect(m.runner.calls.some((c) => c.argv.some((a) => a.endsWith('printManifest.ts')))).toBe(false);
  });
});

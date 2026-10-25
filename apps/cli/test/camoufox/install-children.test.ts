import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CAMOUFOX_BUILDS, type CamoufoxBuild } from '@gmt/core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { planInstall } from '../../src/camoufox/install.js';
import { planLayout } from '../../src/camoufox/layout.js';
import { manifestArgv, manifestFor, parseManifest } from '../../src/camoufox/manifest.js';
import { systemFiles } from '../../src/exec/files.js';
import { systemRunner } from '../../src/exec/runner.js';
import { systemExecutor } from '../../src/exec/system.js';
import { apply } from '../../src/plan/apply.js';
import { LINUX_ENTRIES, MAC_ENTRIES, makeZip } from '../support/zip.js';

// why: these tests start real children (unzip, ln) and serve the archive from a loopback HTTP server, so Stryker's
// per-mutant command leaves this file out (PR #11); install.test.ts covers the planner with stand-ins. No release host
// is ever contacted: the fetch the executor uses sends every request to the loopback server. Each child is the
// executor's own, run to its end (or its bound) before the action resolves, so none outlives its test.
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'gmt-install-'));
  dirs.push(d);
  return d;
};
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let server: Server;
let base = '';
/** What the loopback server answers next: a body, or a redirect to a Location. */
let answer: { body: Buffer } | { location: string } = { body: Buffer.alloc(0) };
const requested: string[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    requested.push(req.url ?? '');
    if ('location' in answer) {
      res.writeHead(302, { location: answer.location });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': answer.body.length });
    res.end(answer.body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const a = server.address();
  if (a === null || typeof a === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${a.port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
/** The executor's fetch: the release URL's path, asked of the loopback server instead (redirects stay manual). */
const loopbackFetch: typeof fetch = (input, init) => {
  const u = new URL(input instanceof Request ? input.url : String(input));
  return fetch(`${base}${u.pathname}`, init);
};

function entryFor(zip: Buffer, over: Partial<CamoufoxBuild> = {}): CamoufoxBuild {
  return { ...CAMOUFOX_BUILDS['darwin-arm64'], sha256: sha(zip), bytes: zip.length, ...over };
}
async function install(root: string, entry: CamoufoxBuild) {
  const p = planInstall({ root, entry, files: systemFiles, freeBytes: 1e12, random: 'r4nd0m00' });
  if (p.kind !== 'install') throw new Error(p.kind);
  const r = await apply(
    { command: 'install', actions: p.actions, notes: [] },
    systemExecutor(systemRunner, { fetch: loopbackFetch }),
  );
  return { p, r };
}
const leftovers = (root: string) =>
  existsSync(root) ? readdirSync(root).filter((n) => n.startsWith('.')) : [];

describe.skipIf(process.platform === 'win32')(
  'the verified install, end to end over loopback (Task 17.1)',
  { timeout: 30_000 },
  () => {
    it('first failing test (§16): a download whose bytes hash differently is refused, the partial file deleted, and no unpack or rename runs', async () => {
      const root = join(tmp(), 'camoufox');
      const zip = makeZip(MAC_ENTRIES);
      answer = { body: zip };
      const { p, r } = await install(root, entryFor(zip, { sha256: 'e'.repeat(64) }));
      expect(r.failed?.action.kind).toBe('download');
      expect(r.failed?.error).toContain(`is not the pinned ${'e'.repeat(64)}; removed`);
      expect(r.notRun.map((a) => a.kind)).toEqual(['unpack', 'writeFile', 'rename', 'remove']);
      expect(leftovers(root)).toEqual([]);
      expect(existsSync(p.bundle)).toBe(false);
    });

    it('a redirect to a host outside the release hosts, or to http:, is refused with nothing kept', async () => {
      for (const location of [
        'https://downloads.example.net/asset.zip',
        'http://github.com/daijro/camoufox/a.zip',
      ]) {
        const root = join(tmp(), 'camoufox');
        const zip = makeZip(MAC_ENTRIES);
        answer = { location };
        const { p, r } = await install(root, entryFor(zip));
        expect(r.failed?.action.kind, location).toBe('download');
        expect(r.failed?.error, location).toMatch(/is not a release host; refused|is not https; refused/);
        expect(leftovers(root)).toEqual([]);
        expect(existsSync(p.bundle)).toBe(false);
      }
    });

    it('the archive is re-hashed and listed before unpacking: an absolute, a .. or an escaping entry installs nothing', async () => {
      for (const name of ['/etc/evil', '../evil', 'Camoufox.app/../../evil']) {
        const root = join(tmp(), 'camoufox');
        const zip = makeZip([...MAC_ENTRIES, { name, data: 'x' }]);
        answer = { body: zip };
        const { p, r } = await install(root, entryFor(zip));
        expect(r.failed?.action.kind, name).toBe('unpack');
        expect(r.failed?.error, name).toContain('nothing unpacked');
        expect(r.notRun.map((a) => a.kind)).toEqual(['writeFile', 'rename', 'remove']);
        expect(existsSync(p.bundle)).toBe(false);
        expect(leftovers(root).filter((n) => n.startsWith('.tmp-'))).toEqual([]);
      }
    });

    it('macOS: unpacked through a 0700 temporary directory, version.json written, renamed into place, then the layout links it', async () => {
      const root = join(tmp(), 'camoufox');
      const zip = makeZip(MAC_ENTRIES);
      answer = { body: zip };
      const entry = entryFor(zip);
      const { p, r } = await install(root, entry);
      expect(r.failed).toBeNull();
      expect(statSync(p.bundle).mode & 0o777).toBe(0o700);
      expect(JSON.parse(readFileSync(join(p.bundle, 'version.json'), 'utf8'))).toEqual({
        version: '152.0.4',
        build: 'beta.28',
        release: 'beta.28',
        sha256: entry.sha256,
      });
      expect(existsSync(join(p.bundle, 'Camoufox.app', 'Contents', 'MacOS', 'camoufox'))).toBe(true);
      expect(existsSync(join(p.bundle, 'Camoufox.app', 'Contents', 'Resources', 'properties.json'))).toBe(
        true,
      );
      expect(leftovers(root)).toEqual([]);
      const layout = planLayout({
        os: 'darwin',
        root,
        bundle: p.bundle,
        entry,
        files: systemFiles,
        random: 'aa',
      });
      if (layout.kind !== 'ok') throw new Error(layout.message);
      expect(
        (await apply({ command: 'layout', actions: layout.actions, notes: [] }, systemExecutor(systemRunner)))
          .failed,
      ).toBeNull();
      expect(lstatSync(join(root, 'Camoufox.app')).isSymbolicLink()).toBe(true);
      expect(realpathSync(join(root, 'Camoufox.app'))).toBe(realpathSync(join(p.bundle, 'Camoufox.app')));
      expect(readFileSync(join(root, 'version.json'), 'utf8')).toBe(
        '{"version":"152.0.4","release":"beta.28"}',
      );
      // a second planner run over the result plans nothing
      expect(planInstall({ root, entry, files: systemFiles, freeBytes: 1e12, random: 'x' }).kind).toBe(
        'installed',
      );
      const again = planLayout({
        os: 'darwin',
        root,
        bundle: p.bundle,
        entry,
        files: systemFiles,
        random: 'bb',
      });
      expect(again.kind === 'ok' ? again.actions : again).toEqual([]);
    });

    it('Linux: the flat bundle is the install directory, executables kept executable', async () => {
      const root = join(tmp(), 'camoufox');
      const zip = makeZip(LINUX_ENTRIES);
      answer = { body: zip };
      const entry = entryFor(zip, { url: CAMOUFOX_BUILDS['linux-x64'].url });
      const { p, r } = await install(root, entry);
      expect(r.failed).toBeNull();
      for (const f of [
        'version.json',
        'camoufox-bin',
        'properties.json',
        'fontconfig/macos/fonts.conf',
        'fonts/macos/Helvetica.ttf',
      ])
        expect(existsSync(join(p.bundle, f)), f).toBe(true);
      expect(statSync(join(p.bundle, 'camoufox-bin')).mode & 0o111).not.toBe(0);
      expect(requested.at(-1)).toBe(new URL(CAMOUFOX_BUILDS['linux-x64'].url).pathname);
    });

    it('the manifest printer the update runs prints this tree’s pin and flags, and refuses an unknown machine', async () => {
      const checkout = join(import.meta.dirname, '..', '..', '..', '..');
      const cwd = join(checkout, 'apps', 'cli');
      const r = await systemRunner(manifestArgv(process.execPath, checkout, 'linux-arm64'), {
        cwd,
        timeoutMs: 30_000,
      });
      expect(r.code).toBe(0);
      expect(parseManifest(r.stdout)).toEqual(manifestFor('linux-arm64'));
      const argv = manifestArgv(process.execPath, checkout, 'linux-arm64');
      const bad = await systemRunner([...argv.slice(0, -1), 'win32-x64'], { cwd, timeoutMs: 30_000 });
      expect(bad.code).toBe(64);
      expect(bad.stdout).toBe('');
    });

    // why: W6: update reads the next commit's pin.ts alone, before the stop, through this code's printer and schema
    it('with --pin it prints the manifest of that copy of pin.ts, and refuses one this code cannot read', async () => {
      const checkout = join(import.meta.dirname, '..', '..', '..', '..');
      const cwd = join(checkout, 'apps', 'cli');
      const d = tmp();
      const pin = readFileSync(join(checkout, 'packages', 'core', 'src', 'camoufox', 'pin.ts'), 'utf8');
      writeFileSync(join(d, 'next.ts'), pin.replaceAll('152.0.4-beta.28', '153.0.1-beta.30'));
      const r = await systemRunner(
        manifestArgv(process.execPath, checkout, 'darwin-arm64', join(d, 'next.ts')),
        {
          cwd,
          timeoutMs: 30_000,
        },
      );
      expect(r.code, r.stderr).toBe(0);
      const m = parseManifest(r.stdout);
      expect(m?.entry.build).toBe('153.0.1-beta.30');
      expect(m?.flags.FORM_VERIFIED).toBe(true);
      writeFileSync(join(d, 'odd.ts'), 'export const CAMOUFOX_PIN = { builds: {} };\n');
      const odd = await systemRunner(
        manifestArgv(process.execPath, checkout, 'darwin-arm64', join(d, 'odd.ts')),
        {
          cwd,
          timeoutMs: 30_000,
        },
      );
      expect(odd.code).toBe(78);
      expect(odd.stdout).toBe('');
      expect(odd.stderr).toContain('is not a pin this code can read');
    });
  },
);

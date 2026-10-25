import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OsArch } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { osArchOf } from '../src/platform.js';
import { fakeInstall, tmpDir, writeFile } from './support/tmp.js';

// why: decision 73 (brief WP17 Task 17.2): camoufox-js reads CAMOUFOX_INSTALL_DIR once, when its module is evaluated,
// so the only proof that the worker's value is the one it uses is a fresh process. These start a real Node child (and,
// for the launch, its stub browser, which exits at once); each is killed in teardown.
const WORKER = fileURLToPath(new URL('../', import.meta.url));
const CHILD = fileURLToPath(new URL('./support/seamChild.ts', import.meta.url));
const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
});
const osArch: OsArch | null = osArchOf(process.platform, process.arch);

function runChild(
  mode: string,
  env: Record<string, string>,
): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['--conditions=@gmt/source', '--import', 'tsx', CHILD, mode], {
      cwd: WORKER,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(c);
    let out = '';
    let err = '';
    c.stdout?.on('data', (b: Buffer) => {
      out += b.toString();
    });
    c.stderr?.on('data', (b: Buffer) => {
      err += b.toString();
    });
    c.once('error', reject);
    c.once('close', (code) => resolve({ code, out, err }));
  });
}
const home = (): { home: string; data: string } => {
  const h = tmpDir();
  const data = join(h, '.local', 'state', 'get-me-there', 'camoufox');
  return { home: h, data };
};
const envFor = (h: { home: string; data: string }): Record<string, string> => {
  const data = tmpDir();
  writeFile(data, 'worker.env', 'CAMOUFOX_WORKER_KEY=synthetic-worker-key-0123456789abcdef\n');
  return { HOME: h.home, PATH: process.env.PATH ?? '/usr/bin:/bin', CAMOUFOX_DATA_DIR: data };
};

describe.skipIf(osArch === null)(
  'the install directory camoufox-js resolves (decision 73)',
  { timeout: 60_000 },
  () => {
    it('is the one run.ts sets for this machine, and the entry’s copy equals it', async () => {
      const h = home();
      const env = envFor(h);
      const r = await runChild('dir', env);
      expect(r.code, r.err).toBe(0);
      const want = osArch?.startsWith('darwin')
        ? join(h.home, '.local', 'share', 'get-me-there', 'camoufox')
        : join(h.home, '.local', 'share', 'get-me-there', 'camoufox', 'browsers', 'official');
      const got: { resolved: string; entry: string } = JSON.parse(r.out);
      expect(got.resolved).toBe(got.entry);
      expect(got.resolved.startsWith(want)).toBe(true);
    });

    it('an inherited CAMOUFOX_INSTALL_DIR stops the process with 78 before any entry runs', async () => {
      const r = await runChild('dir', { ...envFor(home()), CAMOUFOX_INSTALL_DIR: '/elsewhere' });
      expect(r.code).toBe(78);
      expect(r.out).toBe('');
      expect(r.err).toContain('CAMOUFOX_INSTALL_DIR is set');
    });

    it('a launch against this machine’s layout fixture never calls fetch, and leaves the install in place', async () => {
      if (osArch === null) return;
      const h = home();
      const f = fakeInstall(osArch, { home: h.home });
      const env = envFor(h);
      const r = await runChild('launch', env);
      expect(r.code, r.err).toBe(0);
      const got: { fetches: number; error: string | null; fontconfig: string | null } = JSON.parse(r.out);
      expect(got.fetches).toBe(0);
      // why: the fixture's properties.json is empty, so camoufox-js stops inside launchOptions, after it resolved the
      // install (where its download branch would have run) and before any browser starts
      expect(got.error).not.toBeNull();
      expect(got.error).not.toBe('InstallRefused');
      expect(got.fontconfig === null).toBe(osArch.startsWith('darwin'));
      expect(existsSync(join(f.bundleDir, 'version.json'))).toBe(true);
    });

    it('on the refusal paths, a missing and a mismatched bundle, the launch is refused before camoufox-js and fetch is never called', async () => {
      if (osArch === null) return;
      const missing = home();
      const m = await runChild('launch', envFor(missing));
      expect(JSON.parse(m.out)).toEqual({ fetches: 0, error: 'InstallRefused', fontconfig: null });
      const mismatched = home();
      const f = fakeInstall(osArch, {
        home: mismatched.home,
        bundleVersion: { version: '153.0.1', build: 'beta.30', release: 'beta.30' },
        top: { version: '153.0.1', release: 'beta.30' },
      });
      const x = await runChild('launch', envFor(mismatched));
      expect(JSON.parse(x.out)).toEqual({ fetches: 0, error: 'InstallRefused', fontconfig: null });
      expect(existsSync(f.bundleDir)).toBe(true);
      rmSync(mismatched.home, { recursive: true, force: true });
    });
  },
);

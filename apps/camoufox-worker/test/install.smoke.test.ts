import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMOUFOX_BUILDS } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { installDirFor } from '../src/paths.js';
import { osArchOf } from '../src/platform.js';
import { tmpDir, writeFile } from './support/tmp.js';

// The install smoke (decisions 73 and 77; brief WP17 Tasks 17.2 and 17.9). It needs the real Camoufox that `gmt setup`
// installed for this machine's <os>-<arch>, so it runs only with CAMOUFOX_INSTALL_SMOKE=1 (the camoufox-install CI
// job, or the operator by hand) and skips visibly everywhere else, every Stryker run included. It starts the worker's
// own entry point in a child (camoufox-js reads its install directory once, at import), launches headless through
// prepareLaunch and launchContext into a throwaway profile, loads one loopback page the child serves, and reports: no
// Node-side fetch (camoufox-js never reached its download branch), the pinned build, no cookies, and on Linux the
// generated FONTCONFIG_FILE. It never loads any other page.
const WORKER = fileURLToPath(new URL('../', import.meta.url));
const CHILD = fileURLToPath(new URL('./support/seamChild.ts', import.meta.url));
const osArch = osArchOf(process.platform, process.arch);
const installed =
  osArch !== null && existsSync(join(installDirFor(osArch, homedir()), 'version.json'))
    ? CAMOUFOX_BUILDS[osArch].build
    : null;
const enabled = process.env.CAMOUFOX_INSTALL_SMOKE === '1' && installed !== null;
const title = `install smoke: the pinned Camoufox launched through the worker against a loopback page${
  enabled
    ? ''
    : ' (skipped: needs CAMOUFOX_INSTALL_SMOKE=1 and the pinned Camoufox installed by pnpm gmt setup)'
}`;
const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
});

// why: in the camoufox-install job a missing install is a failure, never a quiet skip
describe.skipIf(process.env.CAMOUFOX_INSTALL_SMOKE !== '1')(
  'install smoke: asked for, so the pinned install must be there',
  () => {
    it('finds the bundle gmt setup installed for this machine', () => {
      expect(installed).not.toBeNull();
    });
  },
);

describe.skipIf(!enabled)(title, () => {
  it('launches headless with no Node-side fetch, the pinned build, no cookies and, on Linux, FONTCONFIG_FILE', async () => {
    const data = tmpDir();
    writeFile(data, 'worker.env', 'CAMOUFOX_WORKER_KEY=synthetic-worker-key-0123456789abcdef\n');
    const r = await new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
      const c = spawn(process.execPath, ['--conditions=@gmt/source', '--import', 'tsx', CHILD, 'smoke'], {
        cwd: WORKER,
        env: { HOME: homedir(), PATH: process.env.PATH ?? '/usr/bin:/bin', CAMOUFOX_DATA_DIR: data },
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
    expect(r.code, r.err).toBe(0);
    const got: { fetches: number; build: string; title: string; cookies: number; fontconfig: string | null } =
      JSON.parse(r.out);
    expect(got).toMatchObject({ fetches: 0, build: installed, title: 'loopback smoke', cookies: 0 });
    if (process.platform === 'linux') {
      expect(got.fontconfig).toBe(join(data, 'fonts.conf'));
      expect(readFileSync(join(data, 'fonts.conf'), 'utf8')).not.toContain('prefix="cwd"');
    } else expect(got.fontconfig).toBeNull();
  }, 180_000);
});

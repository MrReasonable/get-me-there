// The launch smoke (brief Task 14.1 Step 5; decision 69 round 2, item 1; TS2-13, SEC-R2-008). It needs the operator's
// real Camoufox, so it runs only when CAMOUFOX_LAUNCH_SMOKE=1 is set and the installed bundle's build equals the pin,
// and skips visibly everywhere else (including every Stryker run, which must never launch a browser). It verifies the
// install layout in ~/Library/Caches/camoufox, launches through the worker's own options into a throwaway profile under
// the checkout's gitignored data/ directory, opens about:blank only (never Google), and writes what it observed to
// fixtures/recorded/launch/<date>.meta.json (gitignored, local-only).
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMOUFOX_JS_VERSION } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import type { PageLike } from '../src/driver.js';
import { installGuard } from '../src/guard.js';
import { DEFAULT_BINARY_BUILD, ensureInstallLayout } from '../src/install.js';
import { buildLaunchOptions, launchContext, launchOptionsForMeta } from '../src/launch.js';
import { installDir } from '../src/paths.js';
import { memoryLog } from './support/log.js';

const PIN = process.env.CAMOUFOX_BINARY_BUILD ?? DEFAULT_BINARY_BUILD;
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const WORKER = fileURLToPath(new URL('../', import.meta.url));

function installedBuilds(): string[] {
  const official = join(installDir(homedir()), 'browsers', 'official');
  try {
    return readdirSync(official).flatMap((id) => {
      try {
        const v: unknown = JSON.parse(readFileSync(join(official, id, 'version.json'), 'utf8'));
        if (typeof v !== 'object' || v === null || !('version' in v) || !('build' in v)) return [];
        return [`${String(v.version)}-${String(v.build)}`];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}
const enabled =
  process.env.CAMOUFOX_LAUNCH_SMOKE === '1' &&
  process.platform === 'darwin' &&
  installedBuilds().includes(PIN);
const title = `launch smoke: Camoufox ${PIN} through camoufox-js's install layout, about:blank only${
  enabled ? '' : ' (skipped: needs CAMOUFOX_LAUNCH_SMOKE=1 and the pinned Camoufox installed on this Mac)'
}`;

/** Every path under the install directory (bundles excepted) with its size and modification time. */
function snapshot(): string[] {
  const root = installDir(homedir());
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (p === join(root, 'browsers')) continue;
      const st = lstatSync(p);
      out.push(`${p.slice(root.length)} ${st.size} ${st.mtimeMs}`);
      if (st.isDirectory()) walk(p);
    }
  };
  walk(root);
  return out.sort();
}

function hasEvaluate(p: PageLike): p is PageLike & { evaluate(fn: () => string): Promise<string> } {
  return 'evaluate' in p && typeof p.evaluate === 'function';
}
const quiet = memoryLog();

describe.skipIf(!enabled)(title, () => {
  it('launches, sits on about:blank for 10 s, has no cookies, contacts no add-on or IP-lookup host, refuses a navigation, closes', async () => {
    const layout = ensureInstallLayout({
      installDir: installDir(homedir()),
      pinnedBuild: PIN,
      installDirOverride: process.env.CAMOUFOX_INSTALL_DIR,
    });
    expect(layout.build).toBe(PIN);
    const options = buildLaunchOptions({
      ffMajor: layout.ffMajor,
      home: homedir(),
      path: process.env.PATH ?? '/usr/bin:/bin',
      tmp: process.env.TMPDIR ?? '/tmp',
    });
    const profile = join(REPO, 'data', 'camoufox-smoke', `profile-${process.pid}-${Date.now()}`);
    mkdirSync(profile, { recursive: true, mode: 0o700 });
    const hosts = new Set<string>();
    const started = Date.now();
    // why: fix round 1 (sec M5, prov-int M8): camoufox-js's add-on download, IP and geolocation lookups and release
    // fetch are Node-side fetches in this process, which the context's request listener can never see; any fetch
    // during the launch throws and is recorded
    const before = snapshot();
    const nodeFetches: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | URL | Request) => {
      nodeFetches.push(input instanceof Request ? input.url : input.toString());
      throw new Error('launch smoke: no Node-side fetch is allowed during the launch');
    };
    let context: Awaited<ReturnType<typeof launchContext>>;
    try {
      context = await launchContext(options, profile);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(nodeFetches).toEqual([]);
    // why: an add-on or GeoIP download would land under the install directory; nothing there changes during the launch
    expect(snapshot()).toEqual(before);
    try {
      context.on('request', (r) => {
        try {
          hosts.add(new URL(r.url()).hostname);
        } catch {
          hosts.add('unparsable');
        }
      });
      const page = await context.newPage();
      await page.goto('about:blank');
      await new Promise((r) => setTimeout(r, 10_000));
      const userAgent = hasEvaluate(page) ? await page.evaluate(() => navigator.userAgent) : '';
      expect(userAgent).toContain(`Firefox/${layout.ffMajor}`);
      expect(await context.cookies()).toEqual([]);
      // why: the context's requests are page traffic only (about:blank makes none); the Node-side hosts are covered by
      // the fetch trap above
      const quietHosts = [...hosts];
      for (const bad of [
        'addons.mozilla.org',
        'github.com',
        'api.ipify.org',
        'ipinfo.io',
        'ifconfig.me',
        'checkip.amazonaws.com',
      ])
        expect(quietHosts).not.toContain(bad);
      const state = await installGuard(context, page, quiet);
      await expect(page.goto('https://www.example.test/', { timeout: 15_000 })).rejects.toThrow();
      expect(state.refused).toBe('off-allowlist');
      const day = new Date().toISOString().slice(0, 10);
      mkdirSync(join(WORKER, 'fixtures', 'recorded', 'launch'), { recursive: true });
      writeFileSync(
        join(WORKER, 'fixtures', 'recorded', 'launch', `${day}.meta.json`),
        `${JSON.stringify(
          {
            recordedAt: new Date().toISOString(),
            recordedBy: 'camoufox-worker launch smoke',
            build: layout.build,
            camoufoxJs: CAMOUFOX_JS_VERSION,
            created: layout.created,
            userAgent,
            hostsWhileIdle: quietHosts,
            nodeFetchesDuringLaunch: nodeFetches,
            launchOptions: launchOptionsForMeta(options),
            durationMs: Date.now() - started,
          },
          null,
          2,
        )}\n`,
      );
    } finally {
      await context.close();
      rmSync(profile, { recursive: true, force: true });
    }
  }, 120_000);
});

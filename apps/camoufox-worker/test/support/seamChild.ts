// A child process for installSeam.test.ts (decision 73): it runs the worker's own entry point, run.ts's `main`, which
// refuses an inherited CAMOUFOX_INSTALL_DIR and sets its own before any entry imports camoufox-js. `dir` reports what
// camoufox-js itself resolved; `launch` goes through prepareLaunch and launchContext against the fake install under
// HOME with `fetch` replaced by a counter, so the test can prove camoufox-js never reached its download branch (which
// calls fetch synchronously in its first launchOptions call). The fake install's binary is a stub that exits at once:
// no browser runs and no page loads. `smoke` (install.smoke.test.ts, the camoufox-install CI job) launches the real
// install under HOME, headless, against a loopback page this process serves, and nothing else.
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/run.js';

let fetches = 0;
globalThis.fetch = async () => {
  fetches++;
  throw new Error('this test makes no network request');
};
const mode = process.argv[2] ?? '';
process.exitCode = await main([mode], {
  dir: async () => async (ctx) => {
    const pkg = await import('camoufox-js/dist/pkgman.js');
    ctx.out(
      JSON.stringify({ resolved: String(pkg.INSTALL_DIR), entry: ctx.env.CAMOUFOX_INSTALL_DIR ?? null }),
    );
    return 0;
  },
  launch: async () => async (ctx) => {
    const { launchContext, prepareLaunch } = await import('../../src/launch.js');
    let error: string | null = null;
    let fontconfig: string | null = null;
    try {
      const p = prepareLaunch({
        platform: process.platform,
        arch: process.arch,
        installDirSet: ctx.env.CAMOUFOX_INSTALL_DIR,
        dataDir: ctx.dataDir,
        home: ctx.env.HOME ?? '',
        path: '/usr/bin:/bin',
        tmp: tmpdir(),
      });
      fontconfig = 'FONTCONFIG_FILE' in p.options.env ? p.options.env.FONTCONFIG_FILE : null;
      const c = await launchContext(p.options, join(ctx.dataDir, 'profile'));
      await c.close();
    } catch (e) {
      error = e instanceof Error ? e.name : 'error';
    }
    ctx.out(JSON.stringify({ fetches, error, fontconfig }));
    return 0;
  },
  smoke: async () => async (ctx) => {
    const { launchContext, prepareLaunch } = await import('../../src/launch.js');
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>loopback smoke</title><p>ok</p>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const a = server.address();
    const port = a !== null && typeof a !== 'string' ? a.port : 0;
    const p = prepareLaunch({
      platform: process.platform,
      arch: process.arch,
      installDirSet: ctx.env.CAMOUFOX_INSTALL_DIR,
      dataDir: ctx.dataDir,
      home: ctx.env.HOME ?? '',
      path: '/usr/bin:/bin',
      tmp: tmpdir(),
    });
    const c = await launchContext(p.options, join(ctx.dataDir, 'profile'));
    let title = '';
    let cookies = -1;
    try {
      const page = await c.newPage();
      await page.goto(`http://127.0.0.1:${port}/`);
      title = 'title' in page && typeof page.title === 'function' ? String(await page.title()) : '';
      cookies = (await c.cookies()).length;
    } finally {
      await c.close();
      await new Promise<void>((r) => server.close(() => r()));
    }
    const env = p.options.env;
    ctx.out(
      JSON.stringify({
        fetches,
        build: p.install.build,
        title,
        cookies,
        fontconfig: 'FONTCONFIG_FILE' in env ? env.FONTCONFIG_FILE : null,
      }),
    );
    return 0;
  },
});

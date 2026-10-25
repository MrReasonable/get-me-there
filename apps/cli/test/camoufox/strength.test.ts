import { parseEnv } from 'node:util';
import { asIsoDateTime, CAMOUFOX_BUILDS } from '@gmt/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type BrowserChoice, browserSetup } from '../../src/camoufox/browserSetup.js';
import { freeBytesAt, installedDigest } from '../../src/camoufox/install.js';
import { linkedFiles, missingSonames, unzipProblem } from '../../src/camoufox/libs.js';
import {
  browserAvailability,
  CONSENT_STEP,
  consentMethodText,
  costsSummary,
  ENABLE_QUESTION,
  RESUME_LINE,
  SERVER_QUESTION,
  SERVER_TEXT,
} from '../../src/camoufox/offer.js';
import { availableNote, camoufoxUpdateStep } from '../../src/camoufox/updateStep.js';
import { appEnvWithBrowser, renderWorkerEnv } from '../../src/camoufox/workerEnv.js';
import { checkWords, workerCheck } from '../../src/camoufox/workerService.js';
import { runCli } from '../../src/cli.js';
import { MemoryFs, memoryRunner, type RunHandler } from '../../src/exec/memory.js';
import type { Action } from '../../src/plan/action.js';
import { refusalWithFix } from '../../src/worker/refusal.js';
import { scriptedAsk, stubHttp } from '../support/deps.js';
import { machine } from '../support/machine.js';

// why: WP17 (Tasks 17.1 and 17.6): the browser step's and the install helpers' exact outcomes, words and plans, so
// each rule is a behaviour a test names (the camoufox mutation scope)
const ENV = '/Users/op/.config/get-me-there/app.env';
const WORKER_ENV = '/Users/op/.local/state/get-me-there/camoufox/worker.env';
const MAC = CAMOUFOX_BUILDS['darwin-arm64'];

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('no fetch in these tests');
  });
});

async function world(o: { check?: string; df?: number; code?: number; stderr?: string } = {}) {
  let started = false;
  const handler: RunHandler = (argv) => {
    if (!started) return undefined;
    if (argv.includes('check') && argv.includes('--json'))
      return {
        code: o.code ?? 0,
        stdout: `noise\n${o.check ?? '{"ok":true}'}\n`,
        ...(o.stderr === undefined ? {} : { stderr: o.stderr }),
      };
    if (argv.includes('counts') && argv.includes('--check')) return { code: 0, stdout: '{"counts":"ok"}\n' };
    if (argv[0] === 'df') return { code: 0, stdout: `h\n/dev/disk 1 1 ${o.df ?? 99_999_999} 1% /\n` };
    if (argv[0] === 'ln') {
      m.fs.symlink(argv[3] ?? '', argv[2] ?? '');
      return { code: 0 };
    }
    return undefined;
  };
  const m = machine({ extra: handler });
  m.fs.file('/work/a.json', '{}', 0o600).dir('/repo/apps/camoufox-worker');
  expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
  let n = 0;
  m.deps.randomBytes = (k) => Buffer.alloc(k, ++n);
  // why: the memory tree's unpack makes an empty directory; the macOS asset holds Camoufox.app
  const unpacking = m.deps.executor;
  m.deps.executor = {
    run: async (a: Action) => {
      const out = await unpacking.run(a);
      if (a.kind === 'unpack') m.fs.dir(`${a.to}/Camoufox.app`);
      return out;
    },
  };
  m.executor.log.length = 0;
  m.runner.calls.length = 0;
  m.io.stdout = '';
  m.io.stderr = '';
  started = true;
  return m;
}
type World = Awaited<ReturnType<typeof world>>;
const run = (
  m: World,
  o: {
    interactive?: boolean;
    answers?: Array<string | boolean>;
    choice?: BrowserChoice | null;
    reconfigure?: boolean;
  } = {},
) =>
  browserSetup(m.deps, {
    interactive: o.interactive ?? false,
    ask: scriptedAsk(o.answers ?? []),
    choice: o.choice === undefined ? { enabled: true } : o.choice,
    reconfigure: o.reconfigure ?? false,
  });
const show = (log: readonly Action[]) =>
  log.map((a) =>
    a.kind === 'run'
      ? `run ${a.argv.join(' ')}`
      : `${a.kind} ${'path' in a ? a.path : 'to' in a ? a.to : 'url' in a ? a.url : ''}`,
  );

describe('workerCheck and its words', () => {
  it('runs run.ts check --json as the service would, and reads the last line', async () => {
    const m = await world();
    expect(await workerCheck(m.deps)).toEqual({ kind: 'ok' });
    expect(m.runner.calls.at(-1)).toMatchObject({
      argv: [
        '/opt/node/bin/node',
        '--conditions=@gmt/source',
        '--import',
        'tsx',
        '/repo/apps/camoufox-worker/src/run.ts',
        'check',
        '--json',
      ],
      cwd: '/repo/apps/camoufox-worker',
      timeoutMs: 60_000,
      env: { PATH: '/opt/node/bin:/usr/bin:/bin:/usr/sbin:/sbin', HOME: '/Users/op' },
    });
  });
  it('a refusal, an unreadable answer and no answer each read as such', async () => {
    const refused = await world({ check: '{"reason":"layout","at":"2026-10-24T09:30:00.000Z"}', code: 78 });
    expect(await workerCheck(refused.deps)).toEqual({
      kind: 'refused',
      refusal: { reason: 'layout', at: '2026-10-24T09:30:00.000Z' },
    });
    for (const check of ['{"ok":false}', '{"reason":"other","at":"x"}', 'null', '{"ok":"true"}'])
      expect(await workerCheck((await world({ check })).deps), check).toEqual({
        kind: 'failed',
        error: 'the worker’s start check printed what this build cannot read',
      });
    expect(await workerCheck((await world({ check: '{', code: 70 })).deps)).toEqual({
      kind: 'failed',
      error: 'the worker’s start check exited 70 and said nothing',
    });
    // why: dev-b1-003: a config error's own words (its last stderr line) reach the operator
    expect(
      await workerCheck(
        (
          await world({
            check: '{',
            code: 78,
            stderr: 'warming up\nremove CAMOUFOX_BINARY_BUILD from worker.env\n',
          })
        ).deps,
      ),
    ).toEqual({
      kind: 'failed',
      error: 'the worker’s start check exited 78: remove CAMOUFOX_BINARY_BUILD from worker.env',
    });
  });
  it('words a refusal with its fix, or without one, through the one formatter', () => {
    const at = asIsoDateTime('2026-10-24T09:30:00.000Z');
    expect(refusalWithFix({ reason: 'locked', at })).toBe(
      'refused, not retrying: another worker holds the lock; fix: pnpm gmt restart',
    );
    expect(refusalWithFix({ reason: 'flags-unset', at })).toBe(
      'refused, not retrying: this machine has no verified browser build yet',
    );
    expect(checkWords({ kind: 'refused', refusal: { reason: 'locked', at } })).toBe(
      refusalWithFix({ reason: 'locked', at }),
    );
    expect(checkWords({ kind: 'failed', error: 'e' })).toBe('e');
  });
});

describe('the wizard’s own consent step (review X5)', () => {
  it('interactive with a display: after the install it runs the capture itself, then turns the provider on', async () => {
    const m = await world({ check: '{"reason":"consent-missing","at":"2026-10-24T09:30:00.000Z"}' });
    const spawned: string[][] = [];
    let checkAnswer = '{"reason":"consent-missing","at":"2026-10-24T09:30:00.000Z"}';
    m.deps.attach = async (argv, _cwd, env) => {
      spawned.push([...argv, JSON.stringify(env)]);
      // why: the capture stored a rejection, so the worker's next check passes
      checkAnswer = '{"ok":true}';
      return 0;
    };
    const inner = m.deps.run;
    m.deps.run = async (argv, opts) =>
      argv.includes('check') && argv.includes('--json')
        ? { code: 0, stdout: `${checkAnswer}\n`, stderr: '' }
        : inner(argv, opts);
    expect(await run(m, { interactive: true, answers: [true] })).toBe('on');
    expect(m.io.stdout).toContain(`${consentMethodText('wizard')}\n`);
    expect(m.io.stdout).toContain(`${CONSENT_STEP}\n`);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.slice(4, 6)).toEqual(['/repo/apps/camoufox-worker/src/run.ts', 'consent']);
    expect(parseEnv(m.fs.read(ENV) ?? '').CAMOUFOX_ENABLED).toBe('true');
  });
  it('a capture that stores nothing stops, provider off, with the command to run when ready', async () => {
    const m = await world({ check: '{"reason":"consent-missing","at":"2026-10-24T09:30:00.000Z"}' });
    m.deps.attach = async () => 69;
    expect(await run(m, { interactive: true, answers: [true] })).toBe('not-set-up');
    expect(m.io.stderr).toContain(
      'The consent capture stored no rejection (it said why above). Run pnpm gmt consent when you are ready.',
    );
    expect(parseEnv(m.fs.read(ENV) ?? '').CAMOUFOX_ENABLED).toBeUndefined();
  });
  it('not interactive, or with no display, it opens no window and names the route instead', async () => {
    const m = await world({ check: '{"reason":"consent-missing","at":"2026-10-24T09:30:00.000Z"}' });
    let spawned = 0;
    m.deps.attach = async () => {
      spawned++;
      return 0;
    };
    expect(await run(m)).toBe('not-set-up');
    expect(m.io.stderr).toContain(consentMethodText('command'));
    expect(spawned).toBe(0);
  });
});

describe('browserSetup’s outcomes and words', () => {
  it('turning it on: the exact plan, the outcome on, and its line', async () => {
    const m = await world();
    expect(await run(m)).toBe('on');
    expect(m.io.stdout).toContain(`\n${costsSummary(MAC)}\n`);
    expect(m.io.stdout).toContain(`${consentMethodText('command')}\n`);
    expect(
      m.io.stdout.endsWith('The browser provider is on: the worker service is installed and running.\n'),
    ).toBe(true);
    const log = show(m.executor.log);
    expect(log.slice(0, 12)).toEqual([
      'mkdir /Users/op/.local/share/get-me-there/camoufox',
      'mkdir /Users/op/.local/share/get-me-there/camoufox/browsers',
      'mkdir /Users/op/.local/share/get-me-there/camoufox/browsers/official',
      `download /Users/op/.local/share/get-me-there/camoufox/.download-152.0.4-beta.28-8b7680a6.zip`,
      'unpack /Users/op/.local/share/get-me-there/camoufox/.tmp-01010101',
      'writeFile /Users/op/.local/share/get-me-there/camoufox/.tmp-01010101/version.json',
      'rename /Users/op/.local/share/get-me-there/camoufox/browsers/official/152.0.4-beta.28-8b7680a6',
      'remove /Users/op/.local/share/get-me-there/camoufox/.download-152.0.4-beta.28-8b7680a6.zip',
      'run ln -s /Users/op/.local/share/get-me-there/camoufox/browsers/official/152.0.4-beta.28-8b7680a6/Camoufox.app /Users/op/.local/share/get-me-there/camoufox/Camoufox.app',
      'writeFile /Users/op/.local/share/get-me-there/camoufox/version.json',
      'mkdir /Users/op/.local/state/get-me-there/camoufox',
      `writeFile ${WORKER_ENV}`,
    ]);
    expect(log.slice(12)).toEqual([
      `writeFile ${ENV}`,
      'run launchctl bootout gui/501/local.get-me-there.app',
      'waitGone ',
      `writeFile ${ENV}`,
      'writeFile /Users/op/Library/LaunchAgents/local.get-me-there.camoufox-worker.plist',
      'run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.camoufox-worker.plist',
      'run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
      'waitHealthy http://127.0.0.1:3000/api/health',
    ]);
    expect(
      m.executor.log
        .filter((a) => a.kind === 'writeFile' && a.path === WORKER_ENV)
        .map((a) => a.kind === 'writeFile' && a.mode),
    ).toEqual([0o600]);
  });
  it('a second run with it on re-renders nothing and says on; a failed re-render is failed', async () => {
    const m = await world();
    await run(m);
    m.executor.log.length = 0;
    expect(await run(m, { choice: null })).toBe('on');
    expect(m.executor.log).toEqual([]);
    m.fs.file('/Users/op/Library/LaunchAgents/local.get-me-there.camoufox-worker.plist', 'changed', 0o644);
    m.deps.executor = {
      run: async () => {
        throw new Error('disk full');
      },
    };
    expect(await run(m, { choice: null })).toBe('failed');
    expect(m.io.stderr).toContain('setup: the worker service: stopped at a failed step');
  });
  it('no terminal and no browser answer: off, asking nothing, printing nothing', async () => {
    const m = await world();
    expect(await run(m, { choice: null })).toBe('off');
    expect(await run(m, { choice: {} })).toBe('off');
    expect(m.io.stdout).toBe('');
    expect(m.executor.log).toEqual([]);
  });
  it('unavailable here: the line, once, and the outcome unavailable', async () => {
    const m = await world();
    m.deps.platform = { ...m.deps.platform, os: 'linux', arch: 'x64' };
    expect(await run(m, { choice: null })).toBe('unavailable');
    expect(m.io.stdout).toBe(
      'The browser provider is not available on this machine yet (no recordings for linux-x64); SearchApi and Travelpayouts work\n',
    );
    m.io.stdout = '';
    expect(await run(m)).toBe('unavailable');
    expect(m.io.stdout.split('not available').length).toBe(2);
  });
  // why: ts-b1-002: Enter on the question turns nothing on; a differing key's question defaults to a new key
  it('the question’s offered defaults: Enter leaves it off; with keys that differ the key question defaults to yes', async () => {
    const m = await world();
    const ask = scriptedAsk(['']);
    expect(await browserSetup(m.deps, { interactive: true, ask, choice: null, reconfigure: false })).toBe(
      'off',
    );
    expect(ask.defaults).toEqual([{ q: ENABLE_QUESTION, def: false }]);
    await run(m);
    m.fs.file(WORKER_ENV, `CAMOUFOX_WORKER_KEY="${'e'.repeat(48)}"\n`, 0o600);
    const key = scriptedAsk(['', '']);
    await browserSetup(m.deps, { interactive: true, ask: key, choice: null, reconfigure: true });
    expect(key.defaults[0]).toEqual({ q: 'Generate a new worker key?', def: true });
  });
  it('a no on a terminal is off, saying so; with no display a no to the typed word is off too', async () => {
    const m = await world();
    expect(await run(m, { interactive: true, answers: [false] })).toBe('off');
    expect(m.io.stdout.endsWith('The browser provider stays off.\n')).toBe(true);
    m.deps.platform = { ...m.deps.platform, hasDisplay: false };
    expect(await run(m, { interactive: true, answers: [true, 'no'] })).toBe('off');
    expect(await run(m, { choice: { enabled: false, acceptServerAddress: true } })).toBe('off');
    expect(await run(m, { choice: { enabled: true } })).toBe('off');
    expect(await run(m, { interactive: true, answers: [true, 'yes'] })).toBe('on');
  });
  it('each stop is not-set-up, with its own words and the resume line', async () => {
    const unzip = await world();
    const inner = unzip.deps.run;
    unzip.deps.run = async (argv, opts) =>
      argv[0] === 'unzip' ? { code: 127, stdout: '', stderr: '' } : inner(argv, opts);
    expect(await run(unzip)).toBe('not-set-up');
    expect(unzip.io.stderr).toBe(
      `unzip is not installed, and the browser provider needs it: macOS ships unzip in /usr/bin; restore it with xcode-select --install\n${RESUME_LINE}\n`,
    );
    const linkDir = await world();
    linkDir.fs.dir('/Users/op/.local/share/get-me-there/camoufox/Camoufox.app');
    expect(await run(linkDir)).toBe('not-set-up');
    expect(linkDir.io.stderr).toContain('is not a symlink to a Camoufox bundle');
    expect(linkDir.executor.log).toEqual([]);
    const broken = await world();
    const exec = broken.deps.executor;
    broken.deps.executor = {
      run: async (a) => (a.kind === 'download' ? Promise.reject(new Error('offline')) : exec.run(a)),
    };
    expect(await run(broken)).toBe('not-set-up');
    expect(broken.io.stderr).toContain('setup: install Camoufox: stopped at a failed step');
    const files = await world();
    const e2 = files.deps.executor;
    files.deps.executor = {
      run: async (a) =>
        a.kind === 'writeFile' && a.path === WORKER_ENV ? Promise.reject(new Error('read-only')) : e2.run(a),
    };
    expect(await run(files)).toBe('not-set-up');
    expect(files.io.stderr).toContain('setup: the worker’s settings: stopped at a failed step');
    const expired = await world({ check: '{"reason":"consent-expired","at":"2026-10-24T09:30:00.000Z"}' });
    expect(await run(expired)).toBe('not-set-up');
    expect(expired.io.stderr).toContain('the consent record has expired: capture again.');
    const voided = await world({ check: '{"reason":"consent-voided","at":"2026-10-24T09:30:00.000Z"}' });
    expect(await run(voided)).toBe('not-set-up');
    expect(voided.io.stderr).toContain(
      'the consent record is an older voided one, which this version does not use: capture a rejection.',
    );
    for (const w of [unzip, linkDir, broken, files, expired, voided])
      expect(parseEnv(w.fs.read(ENV) ?? '').CAMOUFOX_ENABLED).toBeUndefined();
  });
  it('the second time it finds the install and worker.env in place: no download, the same key', async () => {
    const m = await world({ check: '{"reason":"consent-missing","at":"2026-10-24T09:30:00.000Z"}' });
    await run(m);
    const key = parseEnv(m.fs.read(WORKER_ENV) ?? '').CAMOUFOX_WORKER_KEY;
    m.executor.log.length = 0;
    await run(m);
    expect(show(m.executor.log).some((x) => x.startsWith('download'))).toBe(false);
    expect(show(m.executor.log).some((x) => x.startsWith('mkdir'))).toBe(false);
    expect(parseEnv(m.fs.read(WORKER_ENV) ?? '').CAMOUFOX_WORKER_KEY).toBe(key);
    expect(parseEnv(m.fs.read(ENV) ?? '').CAMOUFOX_WORKER_KEY).toBe(key);
  });
  it('a key only the worker holds is replaced by a new one for both files', async () => {
    const m = await world({ check: '{"reason":"consent-missing","at":"2026-10-24T09:30:00.000Z"}' });
    m.fs
      .dir('/Users/op/.local/state/get-me-there/camoufox', 0o700)
      .file(WORKER_ENV, `CAMOUFOX_WORKER_KEY="${'a'.repeat(48)}"\n`, 0o600);
    await run(m);
    const w = parseEnv(m.fs.read(WORKER_ENV) ?? '').CAMOUFOX_WORKER_KEY;
    expect(w).not.toBe('a'.repeat(48));
    expect(parseEnv(m.fs.read(ENV) ?? '').CAMOUFOX_WORKER_KEY).toBe(w);
    expect(show(m.executor.log).filter((x) => x.startsWith('mkdir /Users/op/.local/state'))).toEqual([]);
  });
  it('app.env that would fail the app’s settings check is not turned on', async () => {
    const m = await world();
    m.fs.file(ENV, `${m.fs.read(ENV) ?? ''}CAMOUFOX_EXECUTION_PAGE_CAP="0"\n`, 0o600);
    expect(await run(m)).toBe('not-set-up');
    expect(m.io.stderr).toContain(
      'app.env would not pass the app’s settings check: CAMOUFOX_EXECUTION_PAGE_CAP',
    );
  });
  it('a failed turn-on is failed, saying what stopped', async () => {
    const m = await world();
    const inner = m.deps.executor;
    m.deps.executor = {
      run: async (a) => (a.kind === 'waitHealthy' ? Promise.reject(new Error('unhealthy')) : inner.run(a)),
    };
    expect(await run(m)).toBe('failed');
    expect(m.io.stderr).toContain('setup: the browser provider: stopped at a failed step');
  });
  it('with it on, --reconfigure browser: equal keys keep the key unless asked; the answers file can ask', async () => {
    const m = await world();
    await run(m);
    m.deps.http = stubHttp({ 'GET /v1/status': () => ({ error: 'refused' }) });
    const key = parseEnv(m.fs.read(ENV) ?? '').CAMOUFOX_WORKER_KEY;
    m.executor.log.length = 0;
    expect(await run(m, { reconfigure: true, choice: {} })).toBe('on');
    expect(m.executor.log).toEqual([]);
    expect(m.io.stdout).not.toContain('keys differ');
    expect(await run(m, { reconfigure: true, interactive: true, answers: [''] })).toBe('on');
    expect(parseEnv(m.fs.read(ENV) ?? '').CAMOUFOX_WORKER_KEY).toBe(key);
    expect(await run(m, { reconfigure: true, choice: { rotateKey: true } })).toBe('on');
    expect(parseEnv(m.fs.read(ENV) ?? '').CAMOUFOX_WORKER_KEY).not.toBe(key);
    expect(m.io.stdout).toContain(
      'A new worker key is in worker.env and app.env; the worker and the app restarted.\n',
    );
    expect(show(m.executor.log)).toEqual([
      'run launchctl bootout gui/501/local.get-me-there.camoufox-worker',
      'waitGone ',
      'run launchctl bootout gui/501/local.get-me-there.app',
      'waitGone ',
      `writeFile ${WORKER_ENV}`,
      `writeFile ${ENV}`,
      'run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.camoufox-worker.plist',
      'run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
      'waitHealthy http://127.0.0.1:3000/api/health',
    ]);
  });
});

describe('the counts rewrite under --reconfigure browser: its guards', () => {
  it('a readable counts file is said once and nothing is written; a worker whose counts cannot be read fails with its words', async () => {
    const m = await world();
    await run(m);
    m.executor.log.length = 0;
    m.io.stdout = '';
    expect(await run(m, { reconfigure: true, choice: {} })).toBe('on');
    expect(m.io.stdout).toBe('The worker’s monthly counts file is readable; nothing to rewrite.\n');
    const broken = await world();
    await run(broken);
    const inner = broken.deps.run;
    broken.deps.run = async (argv, opts) =>
      argv.includes('counts')
        ? { code: 78, stdout: '', stderr: 'x\nworker.env must be mode 0600\n' }
        : inner(argv, opts);
    expect(await run(broken, { reconfigure: true, choice: {} })).toBe('failed');
    expect(broken.io.stderr).toContain(
      'the worker could not read its counts (exit 78: worker.env must be mode 0600)',
    );
  });
});

describe('the offer’s fixed words', () => {
  it('pins the costs, the server sentence, the questions and both consent methods', () => {
    expect(costsSummary({ bytes: 1_000_000, unpackedBytes: 2_000_000 })).toBe(
      [
        'Browser provider: Google Flights read by this app’s own Camoufox browser, on this machine. Before you turn it on:',
        '- Terms: read the provider’s terms before enabling it; you are responsible for how it is used.',
        '- Your address and account: every page load comes from this machine’s own address (no proxies), so a block, a verification page or a wider restriction lands on that address, and through it on your other Google use from the same network. The browser profile is never signed in, so your account is never used.',
        '- Brittleness: Google changes the page without notice; a changed page reads as unrecognised and pauses the provider for an hour, never a silent zero.',
        '- Speed: a page takes about 20 to 60 s to load, settle and read, plus the spacing set between pages.',
        '- Availability: it runs only while this machine is on and the worker is running; otherwise its cells read skipped and every other provider runs.',
        '- Disk: Camoufox is a 1 MB download and about 2 MB unpacked, under ~/.local/share/get-me-there/camoufox (pnpm gmt browser install reinstalls it; deleting that directory removes it).',
        '- The worker key: anything that can reach the worker’s address on this machine is stopped only by its key.',
        '- Money: none.',
      ].join('\n'),
    );
    expect(SERVER_TEXT).toBe(
      'Page loads will come from this server’s address, not a home connection. A datacentre address is more likely to be refused or shown a verification page, and each one pauses the provider for 48 hours; any restriction applies to that address. If that is not acceptable, leave the provider off, or run the app on a machine at home.',
    );
    expect(ENABLE_QUESTION).toBe('Turn on the browser provider?');
    expect(SERVER_QUESTION).toBe('Type yes to accept page loads from this server’s address');
    const window =
      'a browser window opens on Google Flights: click Reject all, wait until Google Flights shows, then close the window. The choice is kept only when the cookie’s own value reads as a rejection';
    const fallback =
      'If the window cannot be used, the fallback is to copy the SOCS cookie’s fields from an ordinary private window into pnpm --filter @gmt/camoufox-worker capture-socs, which keeps only a rejection too (a few minutes).';
    expect(consentMethodText('server')).toBe(
      `Consent: this machine has no display, so the choice is captured on a machine that shows the consent page and has the pinned Camoufox (pnpm gmt browser install there), and piped here: pnpm gmt consent export | ssh <this machine> 'cd <checkout> && pnpm gmt consent import' (a few minutes; docs/setup.md#on-a-machine-with-no-display). ${fallback}`,
    );
    expect(consentMethodText('command')).toBe(
      `Consent: Google’s consent page is answered once, by you, with "Reject all". Run pnpm gmt consent: ${window} (a minute or two; docs/setup.md#capture-your-consent-choice). ${fallback}`,
    );
    expect(consentMethodText('wizard')).toBe(
      `Consent: Google’s consent page is answered once, by you, with "Reject all". After the install, ${window} (a minute or two; docs/setup.md#capture-your-consent-choice). ${fallback}`,
    );
    expect(RESUME_LINE).toBe(
      'The browser provider stays off until then; resume with pnpm gmt setup --reconfigure browser',
    );
    expect(browserAvailability({ os: 'win32', arch: 'x64' })).toBeNull();
    expect(browserAvailability({ os: 'darwin', arch: 'arm64' })?.osArch).toBe('darwin-arm64');
    expect(browserAvailability({ os: 'linux', arch: 'arm64' })).toBeNull();
  });
});

describe('update’s Camoufox step, its edges', () => {
  it('on Windows, or a machine with no entry, nothing is read', async () => {
    const m = await world();
    m.deps.platform = { ...m.deps.platform, os: 'win32' };
    m.runner.calls.length = 0;
    expect(await camoufoxUpdateStep(m.deps)).toEqual({ ok: true, after: [] });
    expect(m.runner.calls).toEqual([]);
  });
  it('a pin that cannot be printed (non-zero exit) is the step’s failure when Camoufox is installed', async () => {
    const m = await world();
    m.fs.dir('/Users/op/.local/share/get-me-there/camoufox/browsers/official/x');
    const inner = m.deps.run;
    m.deps.run = async (argv, opts) =>
      argv.some((a) => a.endsWith('printManifest.ts'))
        ? { code: 1, stdout: '{"entry":{}}', stderr: '' }
        : inner(argv, opts);
    expect(await camoufoxUpdateStep(m.deps)).toEqual({
      ok: false,
      message: 'the new code’s Camoufox pin could not be read',
    });
    expect(availableNote('linux-x64')).toBe(
      'The browser provider is now available on linux-x64: turn it on with pnpm gmt setup --reconfigure browser',
    );
  });
});

describe('the install helpers’ edges', () => {
  it('installedDigest reads only a string digest from an object', () => {
    const fs = new MemoryFs(501).file('/b/version.json', '[]').file('/c/version.json', '"x"');
    expect([installedDigest(fs, '/b'), installedDigest(fs, '/c')]).toEqual([null, null]);
  });
  it('df’s fourth column of its last line, whole digits only, at a 15 s bound from /', async () => {
    const fs = new MemoryFs(501).dir('/x');
    const r = memoryRunner(fs, () => ({ code: 0, stdout: 'Filesystem 1 2 3\n  a  b  c  12x  \n' }));
    expect(await freeBytesAt(r, fs, '/x')).toBeNull();
    expect(r.calls[0]).toMatchObject({ cwd: '/', timeoutMs: 15_000 });
    expect(
      await freeBytesAt(
        memoryRunner(fs, () => ({ code: 0, stdout: 'a b c 5 6\nd e f 9 1\n\n' })),
        fs,
        '/x',
      ),
    ).toBe(9 * 1024);
    expect(
      await freeBytesAt(
        memoryRunner(fs, () => ({ code: 0, stdout: 'a b c' })),
        fs,
        '/x',
      ),
    ).toBeNull();
  });
  it('missingSonames needs the whole line; linkedFiles takes .so and .so.N only, sorted', () => {
    expect(
      missingSonames([
        'x libgtk-3.so.0 => not found',
        'libgtk-3.so.0 => not foundx',
        'libz.so =>  not found',
      ]),
    ).toEqual(['libz.so']);
    const fs = new MemoryFs(501)
      .file('/b/z.so', '')
      .file('/b/a.so.1', '')
      .file('/b/libso.txt', '')
      .file('/b/x.so.1a', '')
      .file('/b/camoufox-bin', '');
    expect(linkedFiles(fs, '/b')).toEqual(['/b/a.so.1', '/b/camoufox-bin', '/b/z.so']);
  });
  it('unzip is asked from / with a 15 s bound', async () => {
    const r = memoryRunner(new MemoryFs(501));
    await unzipProblem(r, 'linux');
    expect(r.calls[0]).toMatchObject({ argv: ['unzip', '-v'], cwd: '/', timeoutMs: 15_000 });
  });
  it('worker.env keeps the operator’s own lines, exported ones included, and nothing setup owns twice', () => {
    const r = renderWorkerEnv(
      'k',
      {
        CAMOUFOX_COOLDOWN_HOURS: '48',
        CAMOUFOX_PAGE_TIMEOUT_SECONDS: '90',
        CAMOUFOX_MIN_SPACING_SECONDS: '30',
        CAMOUFOX_MODE: 'list',
        CAMOUFOX_GRID_SCROLL_CAP: '30',
        CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: '5',
        CAMOUFOX_MONTHLY_PAGE_CAP: '1500',
        CAMOUFOX_MONTHLY_SCROLL_CAP: '6000',
        CAMOUFOX_BILLING_DAY: '1',
        POINT_OF_SALE: 'GB',
      },
      'export CAMOUFOX_WORKER_PORT="8091"\n  CAMOUFOX_MODE="grid"\nCAMOUFOX_WORKER_KEY="old"\n# note\n',
    );
    if (!r.ok) throw new Error(r.error);
    const text = r.text;
    expect(text.split('\n').slice(0, 2)).toEqual([
      '# get-me-there browser worker settings, written by `pnpm gmt setup` (docs/setup.md section 14).',
      '# Keep this file 0600. The shared settings must equal app.env’s; setup keeps them equal.',
    ]);
    expect(text).toContain('export CAMOUFOX_WORKER_PORT="8091"\n');
    expect(text).not.toContain('"old"');
    expect(text.match(/CAMOUFOX_MODE/g)).toHaveLength(1);
    expect(
      appEnvWithBrowser('export CAMOUFOX_ENABLED="false"\n# c\n', [['CAMOUFOX_ENABLED', 'true']]),
    ).toEqual({
      ok: true,
      text: 'CAMOUFOX_ENABLED="true"\n# c\n',
    });
  });
});

describe('update’s Camoufox step, each outcome (direct)', () => {
  const ROOT = '/Users/op/.local/share/get-me-there/camoufox';
  const OLD = `${ROOT}/browsers/official/152.0.4-beta.28-8b7680a6`;
  const NEW = { ...MAC, build: '153.0.1-beta.30', sha256: 'c'.repeat(64) };
  const NEW_BUNDLE = `${ROOT}/browsers/official/153.0.1-beta.30-cccccccc`;
  async function updating(o: { os?: 'linux' | 'darwin'; ldd?: string } = {}) {
    const m = await world();
    m.fs.file(`${OLD}/version.json`, '{}');
    if (o.os === 'linux') m.deps.platform = { ...m.deps.platform, os: 'linux' };
    const flags = (await import('../../src/camoufox/manifest.js')).manifestFor('darwin-arm64').flags;
    const inner = m.deps.run;
    m.deps.run = async (argv, opts) => {
      if (argv.some((a) => a.endsWith('printManifest.ts')))
        return { code: 0, stdout: JSON.stringify({ entry: NEW, flags }), stderr: '' };
      if (argv[0] === 'ldd') return { code: 0, stdout: o.ldd ?? '', stderr: '' };
      return inner(argv, opts);
    };
    const exec = m.deps.executor;
    m.deps.executor = {
      run: async (a) => {
        const out = await exec.run(a);
        if (a.kind === 'unpack') m.fs.file(`${a.to}/camoufox-bin`, 'ELF');
        return out;
      },
    };
    m.io.stdout = '';
    return m;
  }
  it('Linux: a new pin installs, and a missing library is said, the old bundle removed after the wait', async () => {
    const m = await updating({ os: 'linux', ldd: '\tlibgtk-3.so.0 => not found\n' });
    const r = await camoufoxUpdateStep(m.deps);
    expect(r).toEqual({ ok: true, after: [{ kind: 'remove', path: OLD, recursive: true }] });
    expect(m.io.stdout).toBe(
      [
        'Downloading Camoufox 153.0.1-beta.30 for linux-arm64 (313 MB) from github.com; this can take several minutes',
        'Checking and unpacking it (about 670 MB on disk)',
        `Camoufox 153.0.1-beta.30 is installed in ${NEW_BUNDLE}`,
        '',
      ].join('\n'),
    );
    expect(m.io.stderr).toContain('Firefox’s libraries are missing on this machine (libgtk-3.so.0)');
    expect(m.fs.read(`${NEW_BUNDLE}/version.json`)).not.toBeNull();
  });
  it('Linux with every library found says nothing more; macOS runs no ldd', async () => {
    const m = await updating({ os: 'linux', ldd: '\tlibc.so.6 => /lib/libc.so.6\n' });
    expect((await camoufoxUpdateStep(m.deps)).ok).toBe(true);
    expect(m.io.stderr).toBe('');
    const mac = await updating({ ldd: '\tlibgtk-3.so.0 => not found\n' });
    expect((await camoufoxUpdateStep(mac.deps)).ok).toBe(true);
    expect(mac.io.stderr).toBe('');
  });
  it('a bundle that is not the pin, or a failed download, is the step’s failure with its words', async () => {
    const refused = await updating();
    refused.fs.file(`${NEW_BUNDLE}/version.json`, '{}');
    const r = await camoufoxUpdateStep(refused.deps);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.message).toContain(
      `${NEW_BUNDLE} is there but is not the pinned Camoufox 153.0.1-beta.30`,
    );
    const failing = await updating();
    const exec = failing.deps.executor;
    failing.deps.executor = {
      run: async (a) => (a.kind === 'download' ? Promise.reject(new Error('offline')) : exec.run(a)),
    };
    const f = await camoufoxUpdateStep(failing.deps);
    expect(f.ok ? '' : f.message).toContain('update: the browser install: stopped at a failed step');
  });
  it('the pin already installed is current: nothing printed, every other bundle removed after the wait', async () => {
    const m = await updating();
    m.fs
      .file(`${NEW_BUNDLE}/version.json`, JSON.stringify({ sha256: NEW.sha256 }))
      .dir(`${NEW_BUNDLE}/Camoufox.app`);
    m.fs
      .symlink(`${ROOT}/Camoufox.app`, `${NEW_BUNDLE}/Camoufox.app`)
      .file(`${ROOT}/version.json`, '{"version":"153.0.1","release":"beta.30"}');
    m.executor.log.length = 0;
    expect(await camoufoxUpdateStep(m.deps)).toEqual({
      ok: true,
      after: [{ kind: 'remove', path: OLD, recursive: true }],
    });
    expect(m.io.stdout).toBe('');
    expect(m.executor.log).toEqual([]);
  });
});

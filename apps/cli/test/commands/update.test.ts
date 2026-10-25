import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import type { RunHandler } from '../../src/exec/memory.js';
import { stubHttp, type TestIo, testIo } from '../support/deps.js';
import { machine } from '../support/machine.js';

const ACTIVE = (finish: string | null) => ({
  execution: {
    id: 'e1',
    definitionId: 'd1',
    definitionName: 'London to New York weekly',
    kind: 'run',
    startedAt: '2026-10-24T09:00:00.000Z',
    estimatedFinishAt: finish,
  },
});
const BACKUP = '/Users/op/.local/share/get-me-there/backups/update/get-me-there-2026-10-24T09-30-00-000Z.db';

/** A set-up machine with a clean main checkout one commit behind origin/main, and the given git and http stand-ins. */
async function world(
  opts: {
    git?: RunHandler;
    active?: unknown[];
    fail?: (a: readonly string[]) => boolean;
    autoResume?: string;
    io?: TestIo;
  } = {},
) {
  const answers = [...(opts.active ?? [{ execution: null }])];
  const http = stubHttp({
    'GET /api/health': () => ({ status: 200, body: { ok: true, degraded: false } }),
    'GET /api/executions/active': () => {
      const a = answers.length > 1 ? answers.shift() : answers[0];
      return typeof a === 'object' && a !== null && 'status' in a && typeof a.status === 'number'
        ? { status: a.status, body: {} }
        : { status: 200, body: a };
    },
  });
  let started = false;
  const m = machine({
    http,
    ...(opts.io ? { io: opts.io } : {}),
    extra: (argv, call) => {
      if (!started) return undefined;
      if (opts.fail?.(argv) === true) return { code: 1, stderr: 'failed in the test' };
      const g = opts.git?.(argv, call);
      if (g !== undefined) return g;
      if (argv[0] === 'git') {
        if (argv[1] === 'status') return { code: 0, stdout: '' };
        if (argv[1] === 'symbolic-ref') return { code: 0, stdout: 'main\n' };
        if (argv[1] === 'rev-parse')
          return { code: 0, stdout: argv[2] === 'HEAD' ? 'aaaa1111\n' : 'bbbb2222\n' };
        return { code: 0 };
      }
      if (
        String(argv[1]).endsWith('backup.mjs') &&
        argv.includes('/Users/op/.local/share/get-me-there/backups/update')
      )
        return { code: 0, stdout: `${JSON.stringify({ ok: true, file: BACKUP })}\n` };
      return undefined;
    },
  });
  m.fs.file('/work/a.json', '{}', 0o600);
  expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
  if (opts.autoResume !== undefined) {
    const env = '/Users/op/.config/get-me-there/app.env';
    m.fs.file(env, `${m.fs.read(env)}AUTO_RESUME=${opts.autoResume}\n`, 0o600);
  }
  m.executor.log.length = 0;
  m.runner.calls.length = 0;
  m.io.stdout = '';
  m.io.stderr = '';
  started = true;
  return { ...m, http };
}
const calls = (m: Awaited<ReturnType<typeof world>>) => m.runner.calls.map((c) => c.argv.join(' '));
const at = (list: string[], pred: (s: string) => boolean) => list.findIndex(pred);

describe('gmt update (decision 80; brief Task 16b.9)', () => {
  it('refuses a checkout with local changes or on another branch, before anything stops', async () => {
    const dirty = await world({
      git: (a) => (a[1] === 'status' ? { code: 0, stdout: ' M apps/api/src/x.ts\n' } : undefined),
    });
    expect(await runCli(['update'], dirty.deps)).toBe(78);
    expect(dirty.io.stderr).toContain('local changes');
    expect(dirty.executor.log).toEqual([]);
    const branch = await world({
      git: (a) => (a[1] === 'symbolic-ref' ? { code: 0, stdout: 'feature\n' } : undefined),
    });
    expect(await runCli(['update'], branch.deps)).toBe(78);
    expect(branch.io.stderr).toContain('not on main');
  });

  it('git fetch and the fast-forward check run while the app runs; a network failure leaves it running', async () => {
    const m = await world({
      git: (a) => (a[1] === 'fetch' ? { code: 128, stderr: 'could not resolve host' } : undefined),
    });
    expect(await runCli(['update'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('git fetch failed; nothing was stopped');
    expect(m.executor.log).toEqual([]);
    const noff = await world({ git: (a) => (a[1] === 'merge-base' ? { code: 1 } : undefined) });
    expect(await runCli(['update'], noff.deps)).toBe(78);
    expect(noff.io.stderr).toContain('cannot fast-forward');
    expect(calls(noff)).toContain('git merge-base --is-ancestor HEAD origin/main');
  });

  it('with origin/main already checked out it says so and stops nothing', async () => {
    const m = await world({ git: (a) => (a[1] === 'rev-parse' ? { code: 0, stdout: 'same\n' } : undefined) });
    expect(await runCli(['update'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain('already up to date');
    expect(m.executor.log).toEqual([]);
  });

  it.each([
    ['an estimate', '2026-10-24T10:15:00.000Z', 'estimated to finish 2026-10-24T10:15:00.000Z'],
    ['no estimate', null, 'estimated to finish unknown'],
  ])('a run active with %s refuses, naming the definition, start and finish', async (_n, finish, text) => {
    const m = await world({ active: [ACTIVE(finish)] });
    expect(await runCli(['update'], m.deps)).toBe(75);
    expect(m.io.stderr).toContain(
      'a search is running in the app: London to New York weekly, started 2026-10-24T09:00:00.000Z',
    );
    expect(m.io.stderr).toContain(text);
    expect(m.executor.log).toEqual([]);
  });
  it.each([
    ['a 401', { status: 401 }],
    ['no answer', 'error'],
  ])('a failed read (%s) while the app service is active refuses', async (_n, answer) => {
    const m = await world();
    m.deps.http =
      answer === 'error'
        ? stubHttp({})
        : stubHttp({ 'GET /api/executions/active': () => ({ status: 401, body: {} }) });
    expect(await runCli(['update'], m.deps)).toBe(75);
    expect(m.io.stderr).toMatch(/cannot tell whether a search is running/);
    expect(m.executor.log).toEqual([]);
  });
  it('with the app service inactive it proceeds without asking the app', async () => {
    const m = await world();
    m.running.clear();
    const http = stubHttp({});
    m.deps.http = http;
    expect(await runCli(['update'], m.deps)).toBe(0);
    // why: CodeRabbit PRRT_kwDOVNmjjs6v7k7u, ts-b1-008: the app was not asked about a run
    expect(http.requests.filter((r) => r.url.endsWith('/api/executions/active'))).toEqual([]);
  });
  it('--wait polls every 60 s until no run is active', async () => {
    const m = await world({ active: [ACTIVE(null), ACTIVE(null), { execution: null }] });
    const slept: number[] = [];
    m.deps.sleep = async (ms) => {
      slept.push(ms);
    };
    expect(await runCli(['update', '--wait'], m.deps)).toBe(0);
    expect(slept.filter((s) => s === 60_000)).toHaveLength(2);
  });
  it.each([
    ['true', 'after the restart the app resumes it from its last checkpoint (AUTO_RESUME is on)'],
    ['false', 'it waits for you to resume it (AUTO_RESUME is off)'],
  ])(
    '--force (AUTO_RESUME=%s) prints decision 80’s statement before its first action',
    async (auto, variant) => {
      const io = testIo();
      let beforeFirst = '';
      const m = await world({ active: [ACTIVE(null)], autoResume: auto, io });
      const exec = m.deps.executor;
      m.deps.executor = {
        run: async (a) => {
          if (beforeFirst === '') beforeFirst = io.stdout;
          return exec.run(a);
        },
      };
      io.stdout = '';
      expect(await runCli(['update', '--force'], m.deps)).toBe(0);
      for (const s of [
        'the app stops within 30 s',
        'a page or call in flight is abandoned, stays on the ledger and has its cells requested again',
        'marked interrupted at its last checkpoint',
        variant,
      ])
        expect(beforeFirst).toContain(s);
    },
  );

  it('the exit code is the update’s own steps and the health wait: an unrelated failing check, or a silent report, does not fail it (V0)', async () => {
    const failingEmail = {
      generatedAt: '2026-10-24T09:30:00.000Z',
      mode: 'native',
      version: 'abc1234',
      checks: [
        {
          id: 'email',
          area: 'email',
          providerId: null,
          label: null,
          state: 'fail',
          summary: 'the last test email failed',
          note: null,
          offReason: null,
          fix: { text: 'check the SMTP settings', command: 'pnpm gmt setup --reconfigure email' },
        },
        {
          id: 'app',
          area: 'app',
          providerId: null,
          label: null,
          state: 'fail',
          summary: 'sign-in is off',
          note: null,
          offReason: null,
          fix: null,
        },
      ],
    };
    const failing = await world();
    failing.deps.http = stubHttp({
      'GET /api/health': () => ({ status: 200, body: { ok: true, degraded: false } }),
      'GET /api/executions/active': () => ({ status: 200, body: { execution: null } }),
      'GET /api/status': () => ({ status: 200, body: failingEmail }),
    });
    expect(await runCli(['update'], failing.deps)).toBe(0);
    expect(failing.io.stdout).toContain('the last test email failed');
    const silent = await world();
    silent.deps.http = stubHttp({
      'GET /api/health': () => ({ status: 200, body: { ok: true, degraded: false } }),
      'GET /api/executions/active': () => ({ status: 200, body: { execution: null } }),
      'GET /api/status': () => ({ error: 'connection refused' }),
    });
    expect(await runCli(['update'], silent.deps)).toBe(0);
    expect(silent.io.stderr).toContain('the app is not answering');
  });
  it('a step of the update itself that fails still fails it', async () => {
    const m = await world({ fail: (a) => a[0] === 'pnpm' && a[1] === 'build' });
    expect(await runCli(['update'], m.deps)).toBe(1);
  });

  it('the plan, in order: record, stop, back up, merge, install, build, re-render, start, health, status', async () => {
    const m = await world();
    expect(await runCli(['update'], m.deps)).toBe(0);
    const c = calls(m);
    const i = {
      record: at(c, (s) => s === 'git rev-parse HEAD'),
      stop: at(c, (s) => s === 'launchctl bootout gui/501/local.get-me-there.app'),
      backup: at(c, (s) =>
        s.includes(
          'backup.mjs --db /Users/op/.local/share/get-me-there/get-me-there.db --dir /Users/op/.local/share/get-me-there/backups/update --keep 5',
        ),
      ),
      merge: at(c, (s) => s === 'git merge --ff-only origin/main'),
      install: at(c, (s) => s === 'pnpm install --frozen-lockfile'),
      build: at(c, (s) => s === 'pnpm build'),
      start: at(c, (s) => s.startsWith('launchctl bootstrap gui/501') && s.endsWith('app.plist')),
    };
    expect(Object.values(i).every((n) => n >= 0)).toBe(true);
    expect(i.record).toBeLessThan(i.stop);
    expect(i.stop).toBeLessThan(i.backup);
    expect(i.backup).toBeLessThan(i.merge);
    expect(i.merge).toBeLessThan(i.install);
    expect(i.install).toBeLessThan(i.build);
    expect(i.build).toBeLessThan(i.start);
    expect(m.executor.log.some((a) => a.kind === 'waitHealthy' && a.timeoutSeconds === 240)).toBe(true);
    expect(m.io.stdout).toContain(`backup before the update: ${BACKUP}`);
    // why: U6 (pf-b1-009): the commit a backup goes with sits beside it
    expect(m.fs.read(`${BACKUP}.commit`)).toBe('aaaa1111\n');
    expect(m.io.stdout).toMatch(/service app +ok/);
  });

  it.each([
    ['merge', (a: readonly string[]) => a[0] === 'git' && a[1] === 'merge'],
    ['install', (a: readonly string[]) => a[0] === 'pnpm' && a[1] === 'install'],
    ['build', (a: readonly string[]) => a[0] === 'pnpm' && a[1] === 'build'],
    ['start', (a: readonly string[]) => a[0] === 'launchctl' && a[1] === 'bootstrap'],
  ])(
    'a failure at %s prints the commit, the backup and both restore paths, and plans nothing further',
    async (step, fail) => {
      const m = await world({ fail });
      expect(await runCli(['update'], m.deps)).toBe(1);
      const e = m.io.stderr;
      for (const s of [
        'aaaa1111',
        BACKUP,
        'git checkout aaaa1111 && pnpm install --frozen-lockfile && pnpm build && pnpm gmt start',
        'pnpm gmt stop',
        `pnpm gmt restore ${BACKUP}`,
      ])
        expect(e).toContain(s);
      expect(m.executor.log.some((a) => a.kind === 'waitHealthy')).toBe(false);
      // why: ts-b1-007: nothing after the failing step is called
      const later: Record<string, string[]> = {
        merge: ['pnpm install --frozen-lockfile', 'pnpm build'],
        install: ['pnpm build'],
        build: [],
        start: [],
      };
      const c = calls(m);
      for (const l of later[step] ?? []) expect(c).not.toContain(l);
      const failedAt = c.findIndex((x) => fail(x.split(' ')));
      expect(c.slice(failedAt + 1).filter((x) => x.startsWith('launchctl bootstrap'))).toEqual([]);
    },
  );
  it('a failed backup before the update changes no code: no merge, install, build or start (ts-b1-007)', async () => {
    const m = await world({
      git: (a) => (String(a[1]).endsWith('backup.mjs') ? { code: 74, stderr: 'disk full' } : undefined),
    });
    expect(await runCli(['update'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain(
      'the backup before the update failed; the code is unchanged and the app is stopped',
    );
    const c = calls(m);
    expect(
      c.some(
        (x) => x.startsWith('git merge ') || x.startsWith('pnpm') || x.startsWith('launchctl bootstrap'),
      ),
    ).toBe(false);
  });
  it('a changed unit is re-rendered and applied before the start (ts-b1-007)', async () => {
    const m = await world();
    m.deps.execPath = '/opt/newer/bin/node';
    m.fs.file('/opt/newer/bin/node', 'n', 0o755);
    expect(await runCli(['update'], m.deps)).toBe(0);
    const w = m.executor.log.find(
      (a) => a.kind === 'writeFile' && a.path.endsWith('local.get-me-there.app.plist'),
    );
    expect(w?.kind === 'writeFile' && w.contents).toContain('/opt/newer/bin/node');
  });
  it('a failed health wait prints the same report', async () => {
    const m = await world();
    const exec = m.deps.executor;
    m.deps.executor = {
      run: async (a) => {
        if (a.kind === 'waitHealthy') throw new Error('not healthy');
        return exec.run(a);
      },
    };
    expect(await runCli(['update'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain(`pnpm gmt restore ${BACKUP}`);
  });
});

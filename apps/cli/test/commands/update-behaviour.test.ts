import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import type { Action } from '../../src/plan/action.js';
import { stubHttp } from '../support/deps.js';
import { machine } from '../support/machine.js';

// why: Ian's ruling on PR #11 (survivors before merge): what update leaves on disk at each failure, the exact recovery
// text the operator follows, the resume rules and the no-change path, each asserted as behaviour.
const DATA = '/Users/op/.local/share/get-me-there';
const BACKUP = `${DATA}/backups/update/get-me-there-2026-10-24T09-30-00-000Z.db`;
const STATE = '/Users/op/.local/state/get-me-there/update.json';

interface Opts {
  head?: string;
  origin?: string;
  porcelain?: string;
  fail?: (argv: readonly string[]) => boolean;
  backupOut?: { code: number; stdout?: string; stderr?: string };
  health?: 'ok' | 503 | 'error';
  failAction?: (a: Action) => boolean;
}

async function world(opts: Opts = {}) {
  let started = false;
  const o = { head: 'aaaa1111', origin: 'bbbb2222', ...opts };
  const http = stubHttp({
    'GET /api/executions/active': () => ({ status: 200, body: { execution: null } }),
    ...(o.health === 'error'
      ? {}
      : {
          'GET /api/health': () =>
            o.health === 503
              ? { status: 503, body: { ok: false } }
              : { status: 200, body: { ok: true, degraded: false } },
        }),
  });
  const m = machine({
    http,
    extra: (argv) => {
      if (!started) return undefined;
      if (o.fail?.(argv) === true) return { code: 1, stderr: 'failed in the test' };
      if (argv[0] === 'git') {
        if (argv[1] === 'status') return { code: 0, stdout: o.porcelain ?? '' };
        if (argv[1] === 'symbolic-ref') return { code: 0, stdout: 'main\n' };
        if (argv[1] === 'rev-parse')
          return { code: 0, stdout: `${argv[2] === 'HEAD' ? o.head : o.origin}\n` };
        if (argv[1] === 'merge' && argv[2] === '--ff-only') o.head = o.origin;
        return { code: 0 };
      }
      if (String(argv[1]).endsWith('backup.mjs') && argv.includes(`${DATA}/backups/update`))
        return o.backupOut ?? { code: 0, stdout: `${JSON.stringify({ ok: true, file: BACKUP })}\n` };
      return undefined;
    },
  });
  m.fs.file('/work/a.json', '{}', 0o600);
  expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
  if (o.failAction !== undefined) {
    const inner = m.deps.executor;
    const failAction = o.failAction;
    m.deps.executor = {
      run: async (a) => {
        if (failAction(a)) throw new Error('refused in the test');
        return inner.run(a);
      },
    };
  }
  m.executor.log.length = 0;
  m.runner.calls.length = 0;
  m.io.stdout = '';
  m.io.stderr = '';
  started = true;
  return { ...m, o };
}
const argvs = (m: Awaited<ReturnType<typeof world>>) => m.runner.calls.map((c) => c.argv.join(' '));
const state = (m: Awaited<ReturnType<typeof world>>): unknown => JSON.parse(m.fs.read(STATE) ?? 'null');
const isPnpm = (step: string) => (a: readonly string[]) => a[0] === 'pnpm' && a[1] === step;

/**
 * The recovery report as the operator reads it after a failed step (spec §13), written out in full; with no backup from
 * this update it says why and gives no restore steps (there is nothing to restore).
 */
const report = (step: string, commit: string, backup: string | { none: string }) =>
  [
    `update stopped at ${step}; nothing was rolled back.`,
    typeof backup === 'string'
      ? `The checkout was at ${commit}; the backup taken before the change is ${backup}.`
      : `The checkout was at ${commit}; there is no backup from this update (${backup.none}).`,
    'To finish the update, fix what failed and run pnpm gmt update again: it carries on from the failed step.',
    'If the database was not migrated (the app never started on the new code), go back to the old code:',
    `  git checkout ${commit} && pnpm install --frozen-lockfile && pnpm build && pnpm gmt start`,
    ...(typeof backup === 'string'
      ? [
          'Otherwise restore the backup (docs/setup.md section 0, "Restore (native)"):',
          '  pnpm gmt stop',
          `  git checkout ${commit}`,
          '  pnpm install --frozen-lockfile',
          '  pnpm build',
          `  pnpm gmt restore ${backup}`,
          '  pnpm gmt start',
        ]
      : []),
    'The checkout is then on a detached commit: run git switch main before the next update.',
    '',
  ].join('\n');

describe('update: what each failure leaves and says (survivors, PR #11)', () => {
  it.each([
    ['the merge', (a: readonly string[]) => a[0] === 'git' && a[1] === 'merge'],
    ['the install', isPnpm('install')],
    ['the build', isPnpm('build')],
  ])(
    'a failure at %s ends stderr with the full recovery report, after its own step report',
    async (step, fail) => {
      const m = await world({ fail });
      expect(await runCli(['update'], m.deps)).toBe(1);
      expect(m.io.stderr.startsWith(`update: ${step}: stopped at a failed step; nothing was undone\n`)).toBe(
        true,
      );
      expect(m.io.stderr.endsWith(report(step, 'aaaa1111', BACKUP))).toBe(true);
    },
  );
  it('a failed health wait reports the health wait step', async () => {
    const m = await world({ failAction: (a) => a.kind === 'waitHealthy' });
    expect(await runCli(['update'], m.deps)).toBe(1);
    expect(m.io.stderr.startsWith('update: the health wait: stopped at a failed step')).toBe(true);
    expect(m.io.stderr.endsWith(report('the health wait', 'aaaa1111', BACKUP))).toBe(true);
    // the record stays, so a re-run carries on
    expect(state(m)).toEqual({ from: 'aaaa1111', to: 'bbbb2222', backup: BACKUP, step: 'built' });
  });
  it('a failed stop leaves update.json at "stopped", with no backup, and runs nothing after it', async () => {
    const m = await world({ fail: (a) => a[0] === 'launchctl' && a[1] === 'bootout' });
    expect(await runCli(['update'], m.deps)).toBe(1);
    expect(m.io.stderr.startsWith('update: stop: stopped at a failed step')).toBe(true);
    expect(state(m)).toEqual({ from: 'aaaa1111', to: 'bbbb2222', backup: null, step: 'stopped' });
    expect(
      argvs(m).some(
        (c) => c.includes('backup.mjs') || c.startsWith('git merge --ff-only') || c.startsWith('pnpm'),
      ),
    ).toBe(false);
  });
  it('a backup that exits non-zero reports its step; one that prints no file says only that; neither changes code', async () => {
    const failing = await world({ backupOut: { code: 74, stderr: 'disk full' } });
    expect(await runCli(['update'], failing.deps)).toBe(1);
    expect(failing.io.stderr.startsWith('update: back up: stopped at a failed step')).toBe(true);
    expect(
      failing.io.stderr.endsWith(
        'the backup before the update failed; the code is unchanged and the app is stopped: pnpm gmt start\n',
      ),
    ).toBe(true);
    const silent = await world({ backupOut: { code: 0, stdout: 'nothing useful\n' } });
    expect(await runCli(['update'], silent.deps)).toBe(1);
    expect(silent.io.stderr).toBe(
      'the backup before the update failed; the code is unchanged and the app is stopped: pnpm gmt start\n',
    );
    for (const m of [failing, silent]) {
      expect(argvs(m).some((c) => c.startsWith('git merge --ff-only') || c.startsWith('pnpm'))).toBe(false);
      expect(state(m)).toEqual({ from: 'aaaa1111', to: 'bbbb2222', backup: null, step: 'stopped' });
    }
  });
  it('a failed .commit sidecar is reported and the update still finishes', async () => {
    const m = await world({ failAction: (a) => a.kind === 'writeFile' && a.path.endsWith('.db.commit') });
    expect(await runCli(['update'], m.deps)).toBe(0);
    expect(m.io.stderr.startsWith('update: record the backup’s commit: stopped at a failed step')).toBe(true);
    const ok = await world();
    expect(await runCli(['update'], ok.deps)).toBe(0);
    expect(ok.io.stderr).toBe('');
    expect(ok.fs.read(`${BACKUP}.commit`)).toBe('aaaa1111\n');
  });
  it('success removes update.json and says which commits it went between', async () => {
    const m = await world();
    expect(await runCli(['update'], m.deps)).toBe(0);
    expect(m.fs.read(STATE)).toBeNull();
    expect(m.io.stdout).toContain('updated aaaa1111 to bbbb2222\n');
    expect(m.io.stdout).not.toContain('running again');
  });
});

describe('update: resuming from update.json (survivors, PR #11)', () => {
  it('after a failed install, update.json records the merge and the backup; the re-run carries on without a second backup or merge', async () => {
    let installFails = true;
    const m = await world({
      fail: (a) => {
        if (!isPnpm('install')(a) || !installFails) return false;
        installFails = false;
        return true;
      },
    });
    expect(await runCli(['update'], m.deps)).toBe(1);
    expect(state(m)).toEqual({ from: 'aaaa1111', to: 'bbbb2222', backup: BACKUP, step: 'merged' });
    m.runner.calls.length = 0;
    m.io.stdout = '';
    expect(await runCli(['update'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain('finishing the update to bbbb2222, from the step after merged\n');
    const c = argvs(m);
    expect(c.some((x) => x.includes('backup.mjs') || x.startsWith('git merge'))).toBe(false);
    expect(c).toContain('pnpm install --frozen-lockfile');
    expect(c).toContain('pnpm build');
    expect(m.io.stdout).toContain('updated aaaa1111 to bbbb2222\n');
    expect(m.fs.read(STATE)).toBeNull();
  });
  it('a resume that fails again keeps the recorded backup in update.json and in its report', async () => {
    const m = await world({ head: 'bbbb2222', fail: isPnpm('build') });
    m.fs.file(
      STATE,
      `${JSON.stringify({ from: 'aaaa1111', to: 'bbbb2222', backup: BACKUP, step: 'installed' })}\n`,
    );
    expect(await runCli(['update'], m.deps)).toBe(1);
    expect(state(m)).toEqual({ from: 'aaaa1111', to: 'bbbb2222', backup: BACKUP, step: 'installed' });
    expect(m.io.stderr.endsWith(report('the build', 'aaaa1111', BACKUP))).toBe(true);
    expect(argvs(m)).not.toContain('pnpm install --frozen-lockfile');
  });
  it('a recorded state with no backup is reported as none recorded', async () => {
    const m = await world({ head: 'bbbb2222', fail: isPnpm('build') });
    m.fs.file(
      STATE,
      `${JSON.stringify({ from: 'aaaa1111', to: 'bbbb2222', backup: null, step: 'merged' })}\n`,
    );
    expect(await runCli(['update'], m.deps)).toBe(1);
    expect(m.io.stderr.endsWith(report('the build', 'aaaa1111', { none: 'none was recorded' }))).toBe(true);
    // the record keeps its missing backup as none: a re-run still reads it
    expect(state(m)).toEqual({ from: 'aaaa1111', to: 'bbbb2222', backup: null, step: 'installed' });
  });
  it('a state at "built" skips both the install and the build', async () => {
    const m = await world({ head: 'bbbb2222' });
    m.fs.file(
      STATE,
      `${JSON.stringify({ from: 'aaaa1111', to: 'bbbb2222', backup: BACKUP, step: 'built' })}\n`,
    );
    expect(await runCli(['update'], m.deps)).toBe(0);
    const c = argvs(m);
    expect(c.some((x) => x.startsWith('pnpm'))).toBe(false);
    expect(m.io.stdout).toContain('updated aaaa1111 to bbbb2222\n');
  });
  it.each([
    [
      'a state for another target',
      JSON.stringify({ from: 'x', to: 'cccc3333', backup: BACKUP, step: 'built' }),
    ],
    [
      'a state before the merge',
      JSON.stringify({ from: 'aaaa1111', to: 'aaaa1111', backup: null, step: 'stopped' }),
    ],
    ['a file that is not JSON', 'not json'],
    ['a file of another shape', JSON.stringify({ step: 'built' })],
  ])('%s is no update in progress: a full update runs', async (_n, text) => {
    const m = await world();
    m.fs.file(STATE, text);
    expect(await runCli(['update'], m.deps)).toBe(0);
    const c = argvs(m);
    expect(c).toContain('git merge --ff-only origin/main');
    expect(c.some((x) => x.includes('backup.mjs'))).toBe(true);
    expect(m.io.stdout).not.toContain('finishing the update');
  });
});

describe('update: no new code, the app not healthy (survivors, PR #11)', () => {
  it.each([503, 'error'] as const)(
    'with HEAD at origin/main and health %s it restarts the app only: no backup, merge, record or backup-job start',
    async (health) => {
      const m = await world({ head: 'bbbb2222', health });
      expect(await runCli(['update'], m.deps)).toBe(0);
      const c = argvs(m);
      expect(
        c.some(
          (x) => x.includes('backup.mjs') || x.startsWith('git merge') || x.startsWith('git merge-base'),
        ),
      ).toBe(false);
      // no stop record (nothing is changed), and the steps' own records are gone once it is healthy
      expect(m.executor.log[0]?.kind === 'writeFile' && m.executor.log[0].path === STATE).toBe(false);
      expect(m.fs.read(STATE)).toBeNull();
      expect(c).toContain('launchctl bootout gui/501/local.get-me-there.app');
      expect(
        c.some(
          (x) =>
            x.includes('local.get-me-there.backup') &&
            !x.startsWith('launchctl print') &&
            !x.startsWith('cat '),
        ),
      ).toBe(false);
      expect(m.io.stdout).toContain('the app is running again at bbbb2222\n');
      expect(m.io.stdout).not.toContain('updated ');
    },
  );
  it('a failed build there says no backup was taken because no code changed', async () => {
    const m = await world({ head: 'bbbb2222', health: 503, fail: isPnpm('build') });
    expect(await runCli(['update'], m.deps)).toBe(1);
    expect(
      m.io.stderr.endsWith(report('the build', 'bbbb2222', { none: 'no code changed, so none was taken' })),
    ).toBe(true);
  });
});

describe('update: the checks before anything stops (survivors, PR #11)', () => {
  it('git runs with the child environment, and a clean status that is only a newline is clean', async () => {
    const m = await world({ porcelain: '\n' });
    expect(await runCli(['update'], m.deps)).toBe(0);
    // the update's own git calls (status, which runs after, reads the branch the way it always does)
    const git = m.runner.calls.filter((c) => c.argv[0] === 'git').slice(0, 5);
    expect(git.slice(0, 2).map((c) => c.argv.join(' '))).toEqual([
      'git status --porcelain',
      'git symbolic-ref -q --short HEAD',
    ]);
    for (const c of git) expect(c.env).toEqual(m.deps.childEnv);
    for (const step of ['git merge --ff-only origin/main', 'pnpm install --frozen-lockfile', 'pnpm build'])
      expect(m.runner.calls.find((c) => c.argv.join(' ') === step)?.env).toEqual(m.deps.childEnv);
  });
  it('without app.env it refuses with 78 before anything runs', async () => {
    const m = await world();
    m.fs.delete('/Users/op/.config/get-me-there/app.env');
    expect(await runCli(['update'], m.deps)).toBe(78);
    expect(m.io.stderr).toBe(
      '/Users/op/.config/get-me-there/app.env is missing or would not pass the app’s settings check: run pnpm gmt setup first\n',
    );
    expect(m.executor.log).toEqual([]);
  });
});

describe('update --dry-run: every phase, in order (survivors, PR #11)', () => {
  it('with new code it names each phase, the state record and the backup placeholder', async () => {
    const m = await world();
    expect(await runCli(['update', '--dry-run'], m.deps)).toBe(0);
    const heads = m.io.stdout.split('\n').filter((l) => /^update[ :]/.test(l));
    expect(heads).toEqual([
      'update --dry-run, without fetching: compares this checkout with the last fetched origin/main (bbbb2222)',
      'update: stop:',
      'update: back up:',
      'update: the merge:',
      'update: the install:',
      'update: the build:',
      'update: start and wait:',
    ]);
    expect(m.io.stdout).toContain(`write ${STATE} (0644, 1 lines)\n`);
    expect(m.io.stdout).not.toContain('note:');
  });
  it('with no new code it plans no backup and no merge', async () => {
    const m = await world({ head: 'bbbb2222', health: 503 });
    expect(await runCli(['update', '--dry-run'], m.deps)).toBe(0);
    const heads = m.io.stdout.split('\n').filter((l) => /^update: /.test(l));
    expect(heads).toEqual([
      'update: stop:',
      'update: the install:',
      'update: the build:',
      'update: start and wait:',
    ]);
  });
  it('a branch read that fails refuses even when it prints main', async () => {
    const m = await world();
    const inner = m.deps.run;
    m.deps.run = async (argv, o) =>
      argv[0] === 'git' && argv[1] === 'symbolic-ref'
        ? { code: 1, stdout: 'main\n', stderr: '' }
        : inner(argv, o);
    expect(await runCli(['update'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('this checkout is not on main');
  });
  it('fetches origin and compares with origin/main', async () => {
    const m = await world();
    expect(await runCli(['update'], m.deps)).toBe(0);
    const git = argvs(m).filter((c) => c.startsWith('git '));
    expect(git.slice(2, 5)).toEqual(['git fetch origin', 'git rev-parse HEAD', 'git rev-parse origin/main']);
  });
});

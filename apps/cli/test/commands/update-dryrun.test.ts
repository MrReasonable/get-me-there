import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { stubHttp } from '../support/deps.js';
import { machine } from '../support/machine.js';

// why: U4 (ca-b1-001, po-b1-003, ca-b1-002): update --dry-run changes nothing; a re-run after a failed step finishes it
const BACKUP = '/Users/op/.local/share/get-me-there/backups/update/get-me-there-2026-10-24T09-30-00-000Z.db';
async function world(opts: { head?: () => string; failInstallOnce?: boolean } = {}) {
  let started = false;
  let installFails = opts.failInstallOnce === true;
  const http = stubHttp({
    'GET /api/executions/active': () => ({ status: 200, body: { execution: null } }),
    'GET /api/health': () => ({ status: 200, body: { ok: true, degraded: false } }),
  });
  const m = machine({
    http,
    extra: (argv) => {
      if (!started) return undefined;
      if (argv[0] === 'git') {
        if (argv[1] === 'status') return { code: 0, stdout: '' };
        if (argv[1] === 'symbolic-ref') return { code: 0, stdout: 'main\n' };
        if (argv[1] === 'rev-parse')
          return { code: 0, stdout: argv[2] === 'HEAD' ? `${opts.head?.() ?? 'aaaa1111'}\n` : 'bbbb2222\n' };
        return { code: 0 };
      }
      if (argv[0] === 'pnpm' && argv[1] === 'install' && installFails) {
        installFails = false;
        return { code: 1, stderr: 'network' };
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
  m.executor.log.length = 0;
  m.runner.calls.length = 0;
  m.io.stdout = '';
  m.io.stderr = '';
  started = true;
  return { ...m, http };
}
const changing = (calls: Array<{ argv: readonly string[] }>) =>
  calls
    .map((c) => c.argv.join(' '))
    .filter((s) => /^(git (fetch|merge )|pnpm|launchctl (bootout|bootstrap|kickstart))|backup\.mjs/.test(s));

describe('update --dry-run (U4)', () => {
  it('prints the plan with the real commands and changes nothing: no fetch, no stop, no backup, no merge', async () => {
    const m = await world();
    expect(await runCli(['update', '--dry-run'], m.deps)).toBe(0);
    expect(m.executor.log).toEqual([]);
    expect(changing(m.runner.calls)).toEqual([]);
    for (const s of [
      'run launchctl bootout gui/501/local.get-me-there.app',
      'backup.mjs --db /Users/op/.local/share/get-me-there/get-me-there.db --dir /Users/op/.local/share/get-me-there/backups/update --keep 5',
      'run git merge --ff-only origin/main',
      'run pnpm install --frozen-lockfile',
      'run pnpm build',
      'wait up to 240 s for http://127.0.0.1:3000/api/health',
    ])
      expect(m.io.stdout).toContain(s);
    expect(m.io.stdout).toContain('without fetching');
  });
});

describe('update resumes after a failed step (U4, ca-b1-002)', () => {
  it('a failed install, then a re-run, plans the install onward instead of saying “already up to date”', async () => {
    let head = 'aaaa1111';
    const m = await world({ head: () => head, failInstallOnce: true });
    expect(await runCli(['update'], m.deps)).toBe(1);
    head = 'bbbb2222';
    m.runner.calls.length = 0;
    m.io.stdout = '';
    expect(await runCli(['update'], m.deps)).toBe(0);
    const c = m.runner.calls.map((x) => x.argv.join(' '));
    expect(c).toContain('pnpm install --frozen-lockfile');
    expect(c).toContain('pnpm build');
    expect(c.some((s) => s.startsWith('git merge'))).toBe(false);
    expect(c.some((s) => s.includes('backup.mjs'))).toBe(false);
    expect(m.io.stdout).not.toContain('already up to date');
    expect(m.io.stdout).toContain('finishing the update to bbbb2222');
  });
  it('“already up to date” only when HEAD matches and the app answers healthy', async () => {
    const m = await world({ head: () => 'bbbb2222' });
    expect(await runCli(['update'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain('already up to date at bbbb2222');
    m.running.clear();
    m.io.stdout = '';
    expect(await runCli(['update'], m.deps)).toBe(0);
    expect(m.io.stdout).not.toContain('already up to date');
    expect(m.runner.calls.map((x) => x.argv.join(' '))).toContain(
      'launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
    );
  });
});

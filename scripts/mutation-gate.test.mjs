import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_TIMEOUT_SHARE, timeoutShare } from './mutation-gate.mjs';

// Ruling 10 (decision 67): Stryker scores a timed-out mutant as detected, so a loaded machine can push the score up.
// The gate fails a run whose timed-out mutants exceed 5% of those tested, so load can never pass the 80% threshold.
const report = (statuses) => ({
  files: { 'src/a.ts': { mutants: statuses.map((status, i) => ({ id: String(i), status })) } },
});
const run = (r) => {
  const dir = mkdtempSync(join(tmpdir(), 'gmt-mutation-'));
  const file = join(dir, 'mutation.json');
  writeFileSync(file, JSON.stringify(r));
  return spawnSync(process.execPath, [resolve(import.meta.dirname, 'mutation-gate.mjs'), file], {
    encoding: 'utf8',
  });
};

// why: the suite starts node several times (the gate script on a written report); 60 s survives a loaded runner, as
// the other node-spawning suites allow (CodeRabbit, ruling 11).
describe('mutation gate: timed-out mutants (ruling 10)', { timeout: 60_000 }, () => {
  it('counts Timeout over the tested mutants (killed, survived, timed out, no coverage); ignored and errors are not tested', () => {
    expect(
      timeoutShare(
        report(['Killed', 'Killed', 'Survived', 'Timeout', 'NoCoverage', 'Ignored', 'CompileError']),
      ),
    ).toEqual({ timedOut: 1, tested: 5, share: 0.2 });
    expect(timeoutShare(report([]))).toEqual({ timedOut: 0, tested: 0, share: 0 });
    expect(MAX_TIMEOUT_SHARE).toBe(0.05);
  });

  it('passes at 5% and fails above it, naming the counts', () => {
    const ok = run(report([...Array(19).fill('Killed'), 'Timeout']));
    expect(ok.status).toBe(0);
    const bad = run(report([...Array(18).fill('Killed'), 'Timeout', 'Timeout']));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('2 of 20 tested mutants timed out');
  });

  it('fails when the report is missing, so a crashed run never passes', () => {
    const r = spawnSync(
      process.execPath,
      [resolve(import.meta.dirname, 'mutation-gate.mjs'), '/nonexistent/m.json'],
      {
        encoding: 'utf8',
      },
    );
    expect(r.status).toBe(1);
  });

  it('fails when no mutant was tested: an empty, truncated or all-error report never passes (CodeRabbit batch 3)', () => {
    for (const r of [
      report([]),
      {},
      { files: {} },
      { files: { 'src/a.ts': {} } },
      report(['CompileError', 'Ignored']),
    ]) {
      const out = run(r);
      expect(out.status, JSON.stringify(r)).toBe(1);
      expect(out.stderr).toContain('holds no tested mutant');
    }
  });

  it('core runs Stryker sandboxed with explicit timeouts and concurrency 2, then the gate', () => {
    const dir = resolve(import.meta.dirname, '../packages/core');
    const cfg = JSON.parse(readFileSync(join(dir, 'stryker.config.json'), 'utf8'));
    expect(cfg).toMatchObject({ inPlace: false, timeoutMS: 60000, timeoutFactor: 3, concurrency: 2 });
    expect(cfg.reporters).toContain('json');
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.scripts.mutate).toBe(
      'stryker run && node ../../scripts/mutation-gate.mjs reports/mutation/mutation.json',
    );
  });

  it('CI runs the mutation gate in its own workflow, on demand and weekly, never on every push', () => {
    const wf = readFileSync(resolve(import.meta.dirname, '../.github/workflows/mutation.yml'), 'utf8');
    expect(wf).toMatch(/workflow_dispatch:/);
    expect(wf).toMatch(/schedule:\s*\n\s+- cron: /);
    expect(wf).not.toMatch(/^\s*push:/m);
    expect(wf).not.toMatch(/^\s*pull_request:/m);
    // the package jobs run Stryker and this gate per shard (scripts/workflows.test.mjs pins the step)
    expect(wf).toMatch(
      /^\s+node \.\.\/\.\.\/scripts\/mutation-gate\.mjs reports\/mutation\/mutation\.json\s*$/m,
    );
    expect(wf).toMatch(/run: pnpm --filter @gmt\/cli mutate\s*$/m);
    const ci = readFileSync(resolve(import.meta.dirname, '../.github/workflows/ci.yml'), 'utf8');
    expect(ci).not.toMatch(/pnpm mutate/);
  });
});

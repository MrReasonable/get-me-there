import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_TIMEOUT_SHARE, mergeReports, mutationScore, timeoutShare } from './mutation-gate.mjs';
import { tempDir } from './test-tempdirs.mjs';

// Ruling 10 (decision 67): Stryker scores a timed-out mutant as detected, so a loaded machine can push the score up.
// The gate fails a run whose timed-out mutants exceed 5% of those tested, so load can never pass the 80% threshold.
const report = (statuses) => ({
  files: { 'src/a.ts': { mutants: statuses.map((status, i) => ({ id: String(i), status })) } },
});
const run = (r) => {
  const dir = tempDir('gmt-mutation-');
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
    // the gate job runs this gate once per package over its shards (scripts/workflows.test.mjs pins the job)
    expect(wf).toContain(
      // why: assembled, so the shell array is not read as a template placeholder
      `node scripts/mutation-gate.mjs --config "$DIR/stryker.config.json" --expect "$SHARDS" "${['$', '{reports[@]}'].join('')}"`,
    );
    expect(wf).toMatch(/run: pnpm --filter @gmt\/cli mutate\s*$/m);
    const ci = readFileSync(resolve(import.meta.dirname, '../.github/workflows/ci.yml'), 'utf8');
    expect(ci).not.toMatch(/pnpm mutate/);
  });
});

// why: the follow-ups PR: a package's mutate files run in shards (mutation.yml), and the package's gate is the one it had
// unsharded: its break threshold and the 5% timeout rule over all its shards' mutants together, never shard by shard
// (one shard holding the few modules whose mutants loop until the timeout must not fail a package that passes)
describe('mutation gate over a package’s shards', { timeout: 60_000 }, () => {
  const GATE = resolve(import.meta.dirname, 'mutation-gate.mjs');
  const shard = (file, statuses) => ({
    files: { [file]: { mutants: statuses.map((status, i) => ({ id: `${file}-${i}`, status })) } },
  });
  const write = (reports, brk = 80) => {
    const dir = tempDir('gmt-mutation-');
    const config = join(dir, 'stryker.config.json');
    writeFileSync(config, JSON.stringify({ thresholds: { high: 90, low: 80, break: brk } }));
    const files = reports.map((r, i) => {
      const f = join(dir, `mutation-${i}.json`);
      writeFileSync(f, JSON.stringify(r));
      return f;
    });
    return { config, files };
  };
  const gate = (args) => spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' });

  it('mutationScore: detected (killed, timed out) over valid (those and survived, no coverage), as Stryker scores', () => {
    expect(
      mutationScore(report(['Killed', 'Timeout', 'Survived', 'NoCoverage', 'Ignored', 'RuntimeError'])),
    ).toBe(50);
    expect(mutationScore(report([]))).toBe(0);
  });
  it('mergeReports joins the shards’ files and refuses a file in two shards', () => {
    const merged = mergeReports([shard('src/a.ts', ['Killed']), shard('src/b.ts', ['Survived'])]);
    expect(Object.keys(merged.files)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(() => mergeReports([shard('src/a.ts', ['Killed']), shard('src/a.ts', ['Killed'])])).toThrow(
      /src\/a\.ts is in two reports/,
    );
  });
  it('timeouts are judged over every shard: 20 of 365 in one shard passes with 848 mutants in all', () => {
    const { config, files } = write([
      shard('src/parseCron.ts', [...Array(345).fill('Killed'), ...Array(20).fill('Timeout')]),
      shard('src/catchUp.ts', Array(483).fill('Killed')),
    ]);
    const r = gate(['--config', config, '--expect', '2', ...files]);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('20 of 848 tested mutants timed out');
  });
  it('the package’s break threshold holds over every shard, from its Stryker config', () => {
    const shards = [
      shard('src/a.ts', [...Array(7).fill('Killed'), ...Array(3).fill('Survived')]),
      shard('src/b.ts', Array(10).fill('Killed')),
    ];
    const pass = write(shards, 85);
    expect(gate(['--config', pass.config, '--expect', '2', ...pass.files]).status).toBe(0);
    const fail = write(shards, 86);
    const r = gate(['--config', fail.config, '--expect', '2', ...fail.files]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('mutation score 85.00 is below the break threshold 86');
  });
  it('a missing or unreadable shard report fails, so a shard that never finished never passes', () => {
    const { config, files } = write([shard('src/a.ts', ['Killed'])]);
    const short = gate(['--config', config, '--expect', '2', ...files]);
    expect(short.status).toBe(1);
    expect(short.stderr).toContain('1 report for 2 shards');
    const bad = gate(['--config', config, '--expect', '2', files[0] ?? '', '/nonexistent/m.json']);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('cannot read the Stryker report /nonexistent/m.json');
  });
});

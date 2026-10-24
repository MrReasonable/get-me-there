import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// why: decisions 77, 78 (WP16b Task 16b.11): the Windows leg runs every suite with vitest's JSON reporter and this
// script compares the results with ci/windows-known-failures.txt, so the list only shrinks; `guard` checks the list
// against `vitest list --json`.
const SCRIPT = join(import.meta.dirname, 'windows-known-failures.mjs');
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function files({ list = '', results = null, listed = null }) {
  const d = mkdtempSync(join(tmpdir(), 'gmt-wkf-'));
  dirs.push(d);
  writeFileSync(join(d, 'known.txt'), list);
  if (results) writeFileSync(join(d, 'results.json'), JSON.stringify(results));
  if (listed) writeFileSync(join(d, 'list.json'), JSON.stringify(listed));
  return d;
}
const run = (d, ...args) =>
  spawnSync(process.execPath, [SCRIPT, ...args, '--root', d, '--list', join(d, 'known.txt')], {
    encoding: 'utf8',
  });
/** vitest's JSON reporter's shape: absolute file names, the full title as ancestors and title joined by a space. */
const results = (d, tests) => ({
  numTotalTests: tests.length,
  testResults: Object.entries(Object.groupBy(tests, (t) => t.file)).map(([file, ts]) => ({
    name: join(d, file),
    status: ts.some((t) => t.status === 'failed') ? 'failed' : 'passed',
    message: '',
    assertionResults: ts.map((t) => ({
      ancestorTitles: t.ancestors,
      title: t.title,
      fullName: [...t.ancestors, t.title].join(' '),
      status: t.status,
    })),
  })),
});
const T = (file, ancestors, title, status) => ({ file, ancestors, title, status });

describe('scripts/windows-known-failures.mjs check', { timeout: 60_000 }, () => {
  it('an empty list with no failure exits 0', () => {
    const d = files({});
    writeFileSync(
      join(d, 'results.json'),
      JSON.stringify(results(d, [T('a/x.test.ts', ['x'], 'works', 'passed')])),
    );
    expect(run(d, 'check', join(d, 'results.json')).status).toBe(0);
  });
  it('an unlisted failure exits 1 and names it', () => {
    const d = files({});
    writeFileSync(
      join(d, 'results.json'),
      JSON.stringify(results(d, [T('a/x.test.ts', ['x'], 'breaks', 'failed')])),
    );
    const r = run(d, 'check', join(d, 'results.json'));
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('unlisted failure: a/x.test.ts > x breaks');
  });
  it('a listed failure exits 0 and prints its key', () => {
    const d = files({ list: '# known on Windows\na/x.test.ts > x breaks\n' });
    writeFileSync(
      join(d, 'results.json'),
      JSON.stringify(results(d, [T('a/x.test.ts', ['x'], 'breaks', 'failed')])),
    );
    const r = run(d, 'check', join(d, 'results.json'));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('known failure: a/x.test.ts > x breaks');
  });
  it('a listed test that passes exits 1 (remove its line)', () => {
    const d = files({ list: 'a/x.test.ts > x works\n' });
    writeFileSync(
      join(d, 'results.json'),
      JSON.stringify(results(d, [T('a/x.test.ts', ['x'], 'works', 'passed')])),
    );
    const r = run(d, 'check', join(d, 'results.json'));
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('listed test passed (remove its line): a/x.test.ts > x works');
  });
  it('a file that failed to load is a failure outside any list', () => {
    const d = files({});
    writeFileSync(
      join(d, 'results.json'),
      JSON.stringify({
        testResults: [
          {
            name: join(d, 'a/y.test.ts'),
            status: 'failed',
            message: 'Cannot find package',
            assertionResults: [],
          },
        ],
      }),
    );
    const r = run(d, 'check', join(d, 'results.json'));
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('file failed to load: a/y.test.ts');
  });
  it('a missing results file exits 1', () => {
    const d = files({});
    expect(run(d, 'check', join(d, 'none.json')).status).toBe(1);
  });
});

describe('scripts/windows-known-failures.mjs guard', { timeout: 60_000 }, () => {
  const listed = (d) => [
    { name: 'x > works', file: join(d, 'a/x.test.ts') },
    { name: 'x > breaks', file: join(d, 'a/x.test.ts') },
    { name: 'x > twin', file: join(d, 'a/t.test.ts') },
    { name: 'x twin', file: join(d, 'a/t.test.ts') },
  ];
  it('passes a list whose every line names one test', () => {
    const d = files({ list: 'a/x.test.ts > x breaks\n\n# a comment\n' });
    writeFileSync(join(d, 'list.json'), JSON.stringify(listed(d)));
    expect(run(d, 'guard', join(d, 'list.json')).status).toBe(0);
  });
  it('a line naming no test fails', () => {
    const d = files({ list: 'a/x.test.ts > x vanished\n' });
    writeFileSync(join(d, 'list.json'), JSON.stringify(listed(d)));
    const r = run(d, 'guard', join(d, 'list.json'));
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('names no test: a/x.test.ts > x vanished');
  });
  it('a duplicate line is refused', () => {
    const d = files({ list: 'a/x.test.ts > x breaks\na/x.test.ts > x breaks\n' });
    writeFileSync(join(d, 'list.json'), JSON.stringify(listed(d)));
    const r = run(d, 'guard', join(d, 'list.json'));
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('duplicate line: a/x.test.ts > x breaks');
  });
  it('a line matching two tests is refused', () => {
    const d = files({ list: 'a/t.test.ts > x twin\n' });
    writeFileSync(join(d, 'list.json'), JSON.stringify(listed(d)));
    const r = run(d, 'guard', join(d, 'list.json'));
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain('matches 2 tests: a/t.test.ts > x twin');
  });
  it('a parameterised test is listed once with its placeholders, and quotes escaped; a line matches it as a pattern', () => {
    const d = files({
      list: 'a/p.test.ts > p the cookie SID before the page\na/p.test.ts > p logs "grid step"\n',
    });
    writeFileSync(
      join(d, 'list.json'),
      JSON.stringify([
        { name: 'p > the cookie %s before the page', file: join(d, 'a/p.test.ts') },
        { name: 'p > logs \\"grid step\\"', file: join(d, 'a/p.test.ts') },
      ]),
    );
    const r = run(d, 'guard', join(d, 'list.json'));
    expect(r.stdout + r.stderr).toBe('guard: ok\n');
    expect(r.status).toBe(0);
  });
  it('a test vitest list leaves out (it.skipIf) is found in the run’s results with --results', () => {
    const d = files({ list: 'a/s.test.ts > s an unreadable directory fails\n' });
    writeFileSync(join(d, 'list.json'), JSON.stringify([]));
    writeFileSync(
      join(d, 'results.json'),
      JSON.stringify(results(d, [T('a/s.test.ts', ['s'], 'an unreadable directory fails', 'failed')])),
    );
    expect(run(d, 'guard', join(d, 'list.json')).status).toBe(1);
    const r = spawnSync(
      process.execPath,
      [
        SCRIPT,
        'guard',
        join(d, 'list.json'),
        '--results',
        join(d, 'results.json'),
        '--root',
        d,
        '--list',
        join(d, 'known.txt'),
      ],
      { encoding: 'utf8' },
    );
    expect([r.status, r.stdout]).toEqual([0, 'guard: ok\n']);
  });
  it('an unknown command is usage (64)', () => {
    const d = files({});
    expect(run(d, 'frob').status).toBe(64);
  });
});

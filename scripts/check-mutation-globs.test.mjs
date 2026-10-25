import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkMutationGlobs, mutatedBy, scopeOf } from './check-mutation-globs.mjs';

// Decision 77, ts3-005 (WP16a Task 16a.8; review R28): a brief's front-matter mutation scope must sit in its package's
// Stryker `mutate` list, or the mutation run silently leaves the file out.
const ROOT = resolve(import.meta.dirname, '..');

/** A brief with this front matter. */
const brief = (fields, status = 'draft') => `---\nwp: 99\n${fields}\nstatus: ${status}\n---\n\n# WP99\n`;

/** A tiny workspace: one package with a Stryker config and three source files, and one brief. */
function workspace(mutate, text) {
  const root = mkdtempSync(join(tmpdir(), 'gmt-globs-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  const pkg = join(root, 'packages', 'core');
  mkdirSync(join(pkg, 'src', 'camoufox'), { recursive: true });
  mkdirSync(join(pkg, 'dist', 'camoufox'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@gmt/core' }));
  writeFileSync(join(pkg, 'stryker.config.json'), JSON.stringify({ mutate }));
  for (const f of [
    'src/a.ts',
    'src/camoufox/builds.ts',
    'src/camoufox/protocol.ts',
    'dist/camoufox/builds.ts',
  ])
    writeFileSync(join(pkg, f), 'export {};\n');
  mkdirSync(join(root, 'docs', 'briefs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'briefs', 'wp99-fixture.md'), text);
  return root;
}

describe('scopeOf: the front-matter mutation scope', () => {
  it('reads mutate and pending as package → paths, empty when absent; prose is never read', () => {
    expect(
      scopeOf(
        `${brief(
          'mutate: {"@gmt/core": ["src/camoufox/builds.ts", "src/labels/*.ts"]}\npending: {"@gmt/cli": ["src/plan/**"]}',
        )}\n\`pnpm --filter @gmt/engine mutate\` ≥ 80% on \`src/tick.ts\`.\n`,
      ),
    ).toEqual({
      mutate: { '@gmt/core': ['src/camoufox/builds.ts', 'src/labels/*.ts'] },
      pending: { '@gmt/cli': ['src/plan/**'] },
      status: 'draft',
      declared: true,
    });
    expect(scopeOf(brief('owner: opus'))).toEqual({
      mutate: {},
      pending: {},
      status: 'draft',
      declared: false,
    });
    expect(scopeOf('# no front matter\nmutate: {"@gmt/core": ["src/a.ts"]}\n')).toEqual({
      mutate: {},
      pending: {},
      status: null,
      declared: false,
    });
  });
  it('S13: CRLF front matter reads as LF; `mutate: {}` declares none; a status keeps only its first word', () => {
    const crlf = brief('mutate: {"@gmt/core": ["src/a.ts"]}').replace(/\n/g, '\r\n');
    expect(scopeOf(crlf)).toEqual({
      mutate: { '@gmt/core': ['src/a.ts'] },
      pending: {},
      status: 'draft',
      declared: true,
    });
    expect(scopeOf(brief('mutate: {}', 'merged (amended by plan decision 19)'))).toEqual({
      mutate: {},
      pending: {},
      status: 'merged',
      declared: true,
    });
  });
  it('a malformed scope fails loudly', () => {
    expect(() => scopeOf(brief('mutate: ["src/a.ts"]'))).toThrow(/mutate: must be an object/);
    expect(() => scopeOf(brief('mutate: {"@gmt/core": [""]}'))).toThrow(/mutate: must be an object/);
    expect(() => scopeOf(brief('mutate: {"@gmt/core": "src/a.ts"}'))).toThrow(/mutate: must be an object/);
    expect(() => scopeOf(brief('mutate: {not json}'))).toThrow();
  });
});

describe('mutatedBy: Stryker’s own matching (minimatch)', () => {
  it('globs, braces, negations and line ranges', () => {
    expect(mutatedBy(['src/camoufox/*.ts'], 'src/camoufox/builds.ts')).toBe(true);
    expect(mutatedBy(['src/camoufox/*.ts'], 'src/camoufox/x/builds.ts')).toBe(false);
    expect(mutatedBy(['src/**/*.ts'], 'src/a.ts')).toBe(true);
    expect(mutatedBy(['src/{a,b}.ts'], 'src/b.ts')).toBe(true);
    expect(mutatedBy(['src/**/*.ts', '!src/a.ts'], 'src/a.ts')).toBe(false);
    expect(mutatedBy(['src/start.ts:10-40'], 'src/start.ts')).toBe(true);
    expect(mutatedBy([], 'src/a.ts')).toBe(false);
  });
});

describe('checkMutationGlobs', () => {
  const SCOPE = brief('mutate: {"@gmt/core": ["src/camoufox/*.ts"]}');
  it('fails a brief whose file no mutate entry covers, naming the brief, the package, the file and the config', () => {
    const root = workspace(['src/a.ts', 'src/camoufox/builds.ts'], SCOPE);
    expect(checkMutationGlobs(root).violations).toEqual([
      "docs/briefs/wp99-fixture.md: @gmt/core src/camoufox/protocol.ts (from src/camoufox/*.ts) is not in packages/core/stryker.config.json's mutate",
    ]);
  });
  it('passes once every matched file is covered; a generated copy under dist is never read', () => {
    const root = workspace(['src/camoufox/{builds,protocol}.ts'], SCOPE);
    expect(checkMutationGlobs(root)).toEqual({ violations: [], pending: [] });
  });
  it('a path that matches nothing fails (a typo can never pass), unless it is pending', () => {
    const typo = workspace(['src/**/*.ts'], brief('mutate: {"@gmt/core": ["src/camoufox/bulids.ts"]}'));
    expect(checkMutationGlobs(typo).violations).toEqual([
      'docs/briefs/wp99-fixture.md: @gmt/core src/camoufox/bulids.ts matches no file (list it under pending until it is written)',
    ]);
    const later = workspace(
      ['src/**/*.ts'],
      brief(
        'mutate: {"@gmt/core": ["src/a.ts"]}\npending: {"@gmt/core": ["src/later.ts"], "@gmt/cli": ["src/plan/**"]}',
      ),
    );
    expect(checkMutationGlobs(later)).toEqual({
      violations: [],
      pending: [
        'docs/briefs/wp99-fixture.md: @gmt/core src/later.ts',
        'docs/briefs/wp99-fixture.md: @gmt/cli src/plan/**',
      ],
    });
  });
  it('a package that does not exist under mutate fails; a package with no Stryker config fails every file', () => {
    const missing = workspace(['src/a.ts'], brief('mutate: {"@gmt/cli": ["src/plan/**"]}'));
    expect(checkMutationGlobs(missing).violations).toEqual([
      'docs/briefs/wp99-fixture.md: @gmt/cli is no package of this workspace (list it under pending until it is)',
    ]);
    const bare = workspace(['src/a.ts'], brief('mutate: {"@gmt/core": ["src/a.ts"]}'));
    writeFileSync(join(bare, 'packages', 'core', 'stryker.config.json'), '{}');
    expect(checkMutationGlobs(bare).violations).toEqual([
      "docs/briefs/wp99-fixture.md: @gmt/core src/a.ts (from src/a.ts) is not in packages/core/stryker.config.json's mutate",
    ]);
  });
  it('a malformed scope is a violation, not a crash', () => {
    const root = workspace(['src/a.ts'], brief('mutate: {"@gmt/core": "src/a.ts"}'));
    expect(checkMutationGlobs(root).violations).toEqual([
      'docs/briefs/wp99-fixture.md: mutate: must be an object of package → non-empty path strings',
    ]);
  });

  it('S13: a brief with no front matter, or none with a mutate line, fails; README.md is not a brief', () => {
    const none = workspace(['src/a.ts'], '# WP99, no front matter\n');
    expect(checkMutationGlobs(none).violations).toEqual([
      'docs/briefs/wp99-fixture.md: no front-matter mutate line (write `mutate: {}` when the brief mutates nothing)',
    ]);
    const silent = workspace(['src/a.ts'], brief('owner: opus'));
    expect(checkMutationGlobs(silent).violations).toHaveLength(1);
    const readme = workspace(['src/a.ts'], brief('mutate: {}'));
    writeFileSync(join(readme, 'docs', 'briefs', 'README.md'), '# Work briefs\n');
    expect(checkMutationGlobs(readme)).toEqual({ violations: [], pending: [] });
  });
  it('S13: a pending entry is reported while the brief is not merged and fails once it is', () => {
    const fields = 'mutate: {}\npending: {"@gmt/core": ["src/a.ts"]}';
    expect(checkMutationGlobs(workspace(['src/a.ts'], brief(fields, 'dispatched')))).toEqual({
      violations: [],
      pending: ['docs/briefs/wp99-fixture.md: @gmt/core src/a.ts'],
    });
    expect(checkMutationGlobs(workspace(['src/a.ts'], brief(fields, 'merged')))).toEqual({
      violations: [
        "docs/briefs/wp99-fixture.md: @gmt/core src/a.ts is still pending in a merged brief (move it to mutate and to the package's Stryker mutate)",
      ],
      pending: [],
    });
  });

  it('passes on this repository, where WP16a’s scope is the core and engine files and WP16b’s the CLI’s', () => {
    expect(checkMutationGlobs(ROOT).violations).toEqual([]);
    const wp16a = scopeOf(readFileSync(join(ROOT, 'docs/briefs/wp16a-local-mode-foundations.md'), 'utf8'));
    expect(wp16a.mutate['@gmt/core']).toEqual(
      expect.arrayContaining(['src/camoufox/builds.ts', 'src/camoufox/settings.ts', 'src/budget/window.ts']),
    );
    expect(wp16a.mutate['@gmt/engine']).toEqual(
      expect.arrayContaining(['src/scheduler/catchUp.ts', 'src/tick.ts', 'src/scheduler/catchUpStart.ts']),
    );
    // why: WP16b landed its scope in mutate (the CLI's planners and system executor); the later packages state theirs
    // as pending until they land
    const wp16b = scopeOf(readFileSync(join(ROOT, 'docs/briefs/wp16b-local-setup-cli.md'), 'utf8'));
    expect(wp16b.pending).toEqual({});
    expect(wp16b.mutate['@gmt/cli']).toEqual(expect.arrayContaining(['src/plan/**', 'src/exec/system.ts']));
    // WP17 part 2 landed its last pending file (the consent line's codec) in mutate
    const wp17 = scopeOf(readFileSync(join(ROOT, 'docs/briefs/wp17-camoufox-install-consent.md'), 'utf8'));
    expect(wp17.pending).toEqual({});
    expect(wp17.mutate['@gmt/camoufox-worker']).toEqual([
      'src/monthly.ts',
      'src/consentLine.ts',
      'src/socsMark.ts',
    ]);
    // WP18 landed its scope in mutate (the report's order and rules in core, its api builders, the consent notice)
    const wp18 = scopeOf(readFileSync(join(ROOT, 'docs/briefs/wp18-status.md'), 'utf8'));
    expect(wp18.pending).toEqual({});
    expect(wp18.mutate['@gmt/core']).toEqual([
      'src/status/report.ts',
      'src/status/rules.ts',
      'src/status/time.ts',
    ]);
    expect(wp18.mutate['@gmt/api']).toEqual(['src/read/status.ts', 'src/read/statusPure.ts']);
    expect(wp18.mutate['@gmt/engine']).toEqual(['src/consentNotice.ts']);
    // the merged packages state the scopes their definitions of done claim (S13)
    const scopeOfBrief = (name) => scopeOf(readFileSync(join(ROOT, 'docs/briefs', name), 'utf8'));
    expect(scopeOfBrief('wp01-core-space-coverage-selection.md').mutate['@gmt/core']).toEqual([
      'src/selection/select.ts',
      'src/coverage/rollUp.ts',
    ]);
    expect(scopeOfBrief('wp02-core-normalise-constraints-alerts.md').mutate['@gmt/core']).toEqual(
      expect.arrayContaining(['src/normalise/hashing.ts', 'src/constraints/*.ts', 'src/alerts/dedup.ts']),
    );
    expect(scopeOfBrief('wp14-browser-provider.md').mutate['@gmt/camoufox-worker']).toHaveLength(8);
    expect(scopeOfBrief('wp15-camoufox-grid.md').mutate['@gmt/camoufox-worker']).toEqual([
      'src/gridNames.ts',
      'src/gridView.ts',
    ]);
  });

  it('the command exits 1 naming a violation and 0 on this repository', { timeout: 60_000 }, () => {
    const script = join(ROOT, 'scripts', 'check-mutation-globs.mjs');
    const bad = workspace(['src/a.ts'], SCOPE);
    const failed = spawnSync(process.execPath, [script, bad], { encoding: 'utf8', timeout: 30_000 });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('src/camoufox/builds.ts (from src/camoufox/*.ts) is not in');
    const ok = spawnSync(process.execPath, [script], { encoding: 'utf8', cwd: ROOT, timeout: 30_000 });
    expect(ok.status).toBe(0);
  });
});

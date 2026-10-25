import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

// why: review wp12-security I1 — a workflow without a permissions block runs with the repository's default token scope,
// which may be read-write. Every workflow must say what it needs, and none may ask to write (decision 63).
const DIR = join(import.meta.dirname, '..', '.github', 'workflows');
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
const text = (f) => readFileSync(join(DIR, f), 'utf8');

const MIN_MAJOR = { 'actions/checkout': 6, 'actions/setup-node': 6, 'pnpm/action-setup': 6 };
/** Every non-local `uses:` must be `owner/repo@<40-hex SHA> # vX.Y.Z`, and a known action's tag must be a Node 24 major. */
function pinProblems(t) {
  const problems = [];
  for (const [, ref, rest] of t.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/gm)) {
    if (ref.startsWith('./')) continue;
    const m = /^(\S+)@([0-9a-f]{40})$/.exec(ref);
    const tag = /^\s+# (v\d+\.\d+\.\d+)/.exec(rest)?.[1];
    if (!m || !tag) {
      problems.push(`${ref}${rest}: not a full SHA with a # vX.Y.Z comment`);
      continue;
    }
    const min = MIN_MAJOR[m[1]];
    if (min !== undefined && Number(tag.slice(1).split('.')[0]) < min)
      problems.push(`${m[1]} ${tag}: before Node 24`);
  }
  return problems;
}

describe('GitHub workflows (least privilege)', () => {
  it('finds at least one workflow', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s declares top-level permissions and grants no write scope', (f) => {
    const t = text(f);
    expect(t).toMatch(/^permissions:\s*\n(?:[ \t]+\S.*\n)+/m);
    expect(t).toMatch(/^permissions:\s*\n\s+contents: read\s*$/m);
    expect(t).not.toMatch(/^\s*[a-z-]+:\s*write\s*$/m);
    expect(t).not.toMatch(/write-all/);
  });

  it.each(files)('%s checks out without persisting the token', (f) => {
    const t = text(f);
    const steps = t.split('actions/checkout@').slice(1);
    for (const s of steps)
      expect(s.split('\n- ')[0].split('\n      - ')[0]).toContain('persist-credentials: false');
  });

  // why: Node 20 actions are deprecated on GitHub-hosted runners; each pin must be a full SHA whose comment names a
  // release that runs on Node 24, and runners are pinned rather than floating on ubuntu-latest.
  // why: WP16b (decision 77): the test job and install-e2e run on a matrix of pinned images, named in the matrix
  it.each(files)('%s pins actions by SHA at Node 24 releases and runners to pinned images', (f) => {
    const t = text(f);
    expect(pinProblems(t)).toEqual([]);
    expect([...t.matchAll(/^\s*(?:-\s+)?uses:/gm)].length).toBeGreaterThan(0);
    const runners = [...t.matchAll(/^\s*runs-on: (\S+)/gm)].map((m) => m[1]);
    expect(runners.length).toBeGreaterThan(0);
    // a matrix runner shows here as the start of its expression; the matrix values are checked below
    for (const r of runners) if (!r.startsWith('${{')) expect(RUNNERS).toContain(r);
    for (const job of Object.values(YAML.parse(t).jobs)) {
      const m = job.strategy?.matrix;
      // an include entry that names no runner (the mutation shards) runs on the job's own runs-on
      const named = [...(m?.runner ?? []), ...(m?.include ?? []).map((e) => e.runner)].filter(
        (r) => r !== undefined,
      );
      if (String(job['runs-on']).includes('matrix.runner')) expect(named.length).toBeGreaterThan(0);
      for (const r of named) expect(RUNNERS).toContain(r);
    }
  });

  const SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
  it.each([
    ['an unpinned tag', 'uses: actions/checkout@v4'],
    ['a short SHA', 'uses: actions/checkout@3d3c42e # v7.0.1'],
    ['a SHA without the tag comment', `uses: actions/checkout@${SHA}`],
    ['a release that runs on Node 20', `uses: actions/checkout@${SHA} # v4.4.0`],
  ])('the pin check fails for %s', (_name, line) => {
    expect(pinProblems(`steps:\n  - ${line}\n`)).not.toEqual([]);
  });
  it('the pin check accepts a full SHA with a Node 24 tag comment and skips local actions', () => {
    expect(pinProblems(`steps:\n  - uses: actions/checkout@${SHA} # v7.0.1\n  - uses: ./local\n`)).toEqual(
      [],
    );
  });

  it('the docker job proves the container refuses the recording tool, and its image scan prunes only the pnpm store', () => {
    const t = text('ci.yml');
    expect(t).toContain('/api/tools/record');
    expect(t).toContain('recording_in_container');
    expect(t).toContain('-path /app/node_modules/.pnpm -prune');
    expect(t).not.toMatch(/-path "\*\/node_modules" -prune/);
  });

  it('the docker job builds on the default builder, so the image is in the daemon the later steps run', () => {
    expect(text('ci.yml')).not.toContain('docker/setup-buildx-action');
  });
});

// why: CodeRabbit batch 3 — the image-history check matched only NAME=value, so a credential baked in another shape
// (an `ENV NAME value` layer, a JSON "token": value) passed; and the compose step's throwaway credentials are said to
// be CI-only and never a real value. The check's own grep patterns are run over sample history lines here.
// why: ruling 11: each case spawns grep; 60 s survives a loaded runner.
describe('the docker job keeps credentials out of the image history', { timeout: 60_000 }, () => {
  const ci = text('ci.yml');
  const line = ci.split('\n').find((l) => l.includes('docker history --no-trunc get-me-there:local')) ?? '';
  const patterns = [...line.matchAll(/-e '([^']+)'/g)].map((m) => m[1]);
  const hits = (sample) =>
    spawnSync('grep', ['-Ei', ...patterns.flatMap((p) => ['-e', p])], {
      input: `${sample}\n`,
      encoding: 'utf8',
      timeout: 30_000,
    }).status === 0;

  // why: PR #3 re-review — grep printed each matching history line, so a real hit would write the credential into a
  // public CI log. The step's own line runs here against a stub docker whose history holds a planted credential: it
  // must fail and say how many lines matched, and its output must hold no part of the planted value.
  it('a planted credential fails the step without any part of it reaching the log', () => {
    const stub = mkdtempSync(join(tmpdir(), 'gmt-docker-stub-'));
    try {
      const planted = 'PLANTEDzq7Xv9Lm2Rk4Tw8Yp';
      writeFileSync(
        join(stub, 'docker'),
        `#!/bin/sh\nprintf '%s\\n' 'ENV NODE_ENV=production' 'ENV SEARCHAPI_KEY=${planted}'\n`,
      );
      chmodSync(join(stub, 'docker'), 0o755);
      const r = spawnSync('/bin/sh', ['-c', line.trim()], {
        encoding: 'utf8',
        timeout: 30_000,
        env: { PATH: `${stub}:/usr/bin:/bin` },
      });
      const output = `${r.stdout}${r.stderr}`;
      expect(r.status).toBe(1);
      expect(output).toContain('1 credential-like line');
      for (let i = 0; i + 4 <= planted.length; i++) expect(output).not.toContain(planted.slice(i, i + 4));
      expect(output).not.toContain('SEARCHAPI_KEY');
    } finally {
      rmSync(stub, { recursive: true, force: true });
    }
  });

  it('a clean history passes the step silently', () => {
    const stub = mkdtempSync(join(tmpdir(), 'gmt-docker-stub-'));
    try {
      writeFileSync(join(stub, 'docker'), "#!/bin/sh\nprintf '%s\\n' 'ENV NODE_ENV=production'\n");
      chmodSync(join(stub, 'docker'), 0o755);
      const r = spawnSync('/bin/sh', ['-c', line.trim()], {
        encoding: 'utf8',
        timeout: 30_000,
        env: { PATH: `${stub}:/usr/bin:/bin` },
      });
      expect([r.status, r.stdout, r.stderr]).toEqual([0, '', '']);
    } finally {
      rmSync(stub, { recursive: true, force: true });
    }
  });

  it('greps with explicit -e patterns', () => {
    expect(patterns.length).toBeGreaterThan(1);
  });

  // why: PR #3 review — a suffixed name (SECRET_KEY_BASE) slipped past both patterns; each credential word is tried
  // inside a longer name, in the = form and in the ENV space form
  const WORDS = ['token', 'key', 'pass', 'passwd', 'password', 'secret', 'auth', 'bearer', 'credential'];
  it.each(
    WORDS.flatMap((w) => [
      `ENV X_${w.toUpperCase()}_BASE=value`,
      `ENV ${w.toUpperCase()}_FILE value`,
      `ENV app_${w}=value`,
    ]),
  )('flags %s', (sample) => {
    expect(hits(sample)).toBe(true);
  });

  it.each([
    'ENV SECRET_KEY_BASE=value',
    'ENV AWS_ACCESS_KEY_ID=AKIA0000',
    'ENV SEARCHAPI_KEY=sk-123456',
    '/bin/sh -c #(nop)  ENV APP_BASIC_AUTH_PASS hunter2-value',
    'ENV TRAVELPAYOUTS_TOKEN abc123',
    'ARG SMTP_PASS=abc',
    'LABEL config={"token": "abc"}',
    'ENV client_secret: abc',
  ])('flags %s', (sample) => {
    expect(hits(sample)).toBe(true);
  });

  it.each([
    'RUN /bin/sh -c pnpm install --frozen-lockfile',
    'ENV NODE_ENV=production',
    'ENV PNPM_HOME=/pnpm',
    'COPY --chown=node:node packages/ ./packages/',
    'LABEL org.opencontainers.image.description=no secret is baked in',
  ])('passes %s', (sample) => {
    expect(hits(sample)).toBe(false);
  });

  it("says the compose step's credentials are throwaway CI values that must never match a real credential", () => {
    expect(ci).toContain('# why: CI-only throwaway values that must never match a real credential');
  });
});

// why: WP14 Task 14.11 (arch-002, devops-002, devops-012, TS2-11): the image and the app service carry no browser, and
// CI proves the app runs with the camoufox worker absent.
describe('WP14: the image stays browser-free and the app runs without the camoufox worker', () => {
  const repo = join(import.meta.dirname, '..');
  const read = (p) => readFileSync(join(repo, p), 'utf8');
  const ci = text('ci.yml');
  it('compose has no camoufox or browser service, and app has no extra_hosts but the worker URL default', () => {
    const compose = read('docker-compose.yml');
    const services = [...compose.matchAll(/^ {2}([a-z][a-z0-9_-]*):\s*$/gm)].map((m) => m[1]);
    expect(services.filter((s) => /^(camoufox|browser)/.test(s))).toEqual([]);
    expect(compose).not.toMatch(/extra_hosts/);
    expect(compose).toContain(
      // why: assembled, so the compose interpolation is not read as a template placeholder
      ['CAMOUFOX_WORKER_URL: "', '$', '{CAMOUFOX_WORKER_URL:-http://host.docker.internal:8090}"'].join(''),
    );
  });
  it('the Dockerfile installs with the worker filtered out, and .dockerignore keeps only its manifest', () => {
    expect(read('Dockerfile')).toContain("pnpm install --frozen-lockfile --filter '!@gmt/camoufox-worker'");
    const ignore = read('.dockerignore').split('\n');
    expect(ignore).toContain('apps/camoufox-worker/**');
    expect(ignore).toContain('!apps/camoufox-worker/package.json');
  });
  it('the docker job asserts no worker, no browser library (by glob) and no browser in the image', () => {
    expect(ci).toContain('! test -e /app/apps/camoufox-worker');
    expect(ci).toContain(
      '! ls -d /app/node_modules/.pnpm/camoufox-js@* /app/node_modules/.pnpm/playwright-core@* 2>/dev/null',
    );
    expect(ci).toContain('! command -v firefox');
  });
  it('CI has the "camoufox-worker absent" step: its own project, the key from the shell, cells skipped, no ledger row', () => {
    const at = ci.indexOf('app runs with the camoufox-worker absent');
    expect(at).toBeGreaterThan(0);
    const step = ci.slice(at, ci.indexOf('- name:', at + 10));
    expect(step).toContain('docker compose -p gmt-cfabsent up -d');
    expect(step).toContain('export CAMOUFOX_ENABLED=true CAMOUFOX_WORKER_KEY=');
    expect(step).toContain('provider_unavailable');
    expect(step).toContain('docker compose -p gmt-cfabsent down -v');
    expect(step).not.toMatch(/>>?\s*\.env/);
  });
  // why: the project's rule (Ian, PR #11): CI waits on events, never a poll or a fixed sleep; the run's own log line
  // ends the wait, read from an instant taken before the run starts
  it('the docker job waits on events: the run’s "pass finished" line, never a poll or a sleep', () => {
    const job = YAML.parse(ci).jobs.docker;
    const runs = job.steps.map((s) => s.run ?? '').join('\n');
    expect(runs).not.toMatch(/seq 1|sleep \d|until |while /);
    const step = job.steps.find(
      (s) => s.name === 'app runs with the camoufox-worker absent (WP14, devops-012)',
    ).run;
    const at = (x) => {
      const i = step.indexOf(x);
      expect(i, x).toBeGreaterThan(-1);
      return i;
    };
    expect(at('since="$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)"')).toBeLessThan(
      at('"$base/definitions/$def/executions"'),
    );
    const wait = step.search(
      /node scripts\/until-log-line\.mjs --msg 'execution: pass finished' --field "executionId=\$exe" -- \\\n\s+docker compose -p gmt-cfabsent logs --follow --no-log-prefix --since "\$since" app\n/,
    );
    expect(at('"$base/definitions/$def/executions"')).toBeLessThan(wait);
    expect(wait).toBeLessThan(at('"$base/executions/$exe"'));
    // every other wait in the job is compose's own, on the healthcheck
    for (const m of runs.matchAll(/docker compose (?:-p \S+ )?up -d([^\n]*)/g))
      expect(m[1]).toMatch(/--wait --wait-timeout \d+/);
  });
  it('the run logs "execution: pass finished" with its execution id, after writing its final status', () => {
    const src = readFileSync(join(repo, 'packages/engine/src/execute.ts'), 'utf8');
    const finish = src.slice(src.indexOf('export async function finish('));
    expect(finish.indexOf('ctx.repos.executions.setStatus(run.executionId, status, patch)')).toBeGreaterThan(
      0,
    );
    expect(finish.indexOf("'execution: pass finished'")).toBeGreaterThan(
      finish.indexOf('ctx.repos.executions.setStatus(run.executionId, status, patch)'),
    );
    expect(readFileSync(join(repo, 'packages/engine/src/run.ts'), 'utf8')).toContain(
      'log: ctx.log.child({ executionId: exec.id, definitionId: exec.definitionId })',
    );
  });
});

// why: WP14 fix round 1 (TS I6, TS M9): the worker's recorded suites skip visibly too, and the size limit is pinned
describe('WP14 fix round 1: the worker recorded suites and the image size step', () => {
  const ci = text('ci.yml');
  const step = (name) => ci.split(`- name: ${name}`)[1]?.split('\n      - ')[0] ?? '';
  it('the visible-skip step runs the worker project and greps each worker suite title', () => {
    const s = step('recording-dependent suites skip visibly (decision 61)');
    expect(s).toContain('--project camoufox-worker');
    expect(s).toContain('test/recorded.test.ts');
    expect(s).toContain('test/names.test.ts');
    for (const title of [
      'recorded results pages (spec §2, Task 14.2)',
      'recorded cheapest pages (spec §2, Task 14.2)',
      'recorded view-more pages (spec §2, Task 14.2)',
      'recorded SOCS stability (ruling 9)',
      'recorded consent probe (rule 3)',
      'recorded no-flights page (rule 4)',
      'recorded result names parse (Task 14.2 results kind)',
      'recorded operated-by names parse (Task 14.2 view-more kind)',
    ])
      expect(s, title).toContain(`'${title}'`);
  });
  it('the image size step fails above 5 MB over main', () => {
    const s = step("Image size stays within 5 MB of main's (WP14, arch-002)");
    expect(s).toContain('test $(( new - old )) -le 5000000');
    expect(s).toContain("docker image inspect get-me-there:main --format '{{.Size}}'");
  });
});

describe('WP16a: the mutation workflow runs every package’s Stryker gate and the glob check', () => {
  const t = () => text('mutation.yml');
  const runs = (j) => j.steps.map((s) => s.run).filter((r) => r !== undefined);
  // why: the follow-ups PR: one job held core, engine, api and the worker in a row and ran past its 120 minutes (run
  // 40173525400; main's weekly run on 2026-10-19); core alone needed about 3.2 hours. Each package now has a job of its
  // own (a shard of one, or several where a cold run would not fit), incremental like the CLI's.
  const MUTATED = ['packages/core', 'packages/engine', 'apps/api', 'apps/camoufox-worker'];
  it('runs the mutation-glob check in a job of its own, each package in its own shards and the CLI in its own job', () => {
    const jobs = YAML.parse(t()).jobs;
    expect(Object.keys(jobs)).toEqual(['mutation-globs', 'mutate', 'mutate-cli']);
    expect(runs(jobs['mutation-globs'])).toEqual([
      'pnpm install --frozen-lockfile',
      'node scripts/check-mutation-globs.mjs',
    ]);
    expect(runs(jobs['mutate-cli'])).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm --filter @gmt/cli mutate',
    ]);
    const include = jobs.mutate.strategy.matrix.include;
    expect([...new Set(include.map((e) => e.dir))]).toEqual(MUTATED);
    for (const dir of MUTATED) {
      const mine = include.filter((e) => e.dir === dir);
      const n = mine[0].shards;
      // every shard of the package once, all of one count, so the shards hold every mutated file exactly once
      expect(
        mine.map((e) => e.shards),
        dir,
      ).toEqual(mine.map(() => n));
      expect(
        mine.map((e) => e.shard),
        dir,
      ).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      for (const e of mine) expect(e.package, dir).toBe(dir.split('/')[1]);
    }
    expect(jobs.mutate.strategy['fail-fast']).toBe(false);
  });
  it('each shard mutates its own files, gates on timeouts and caches its incremental file, inside 120 minutes', () => {
    const job = YAML.parse(t()).jobs.mutate;
    expect(job['timeout-minutes']).toBeLessThanOrEqual(120);
    const X = ['$', '{{'].join('');
    expect(job.env).toEqual({ SHARD: `${X} matrix.shard }}`, SHARDS: `${X} matrix.shards }}` });
    const run = job.steps.find((s) => String(s.run ?? '').includes('stryker run'));
    expect(run['working-directory']).toBe(`${X} matrix.dir }}`);
    expect(String(run.run).trim().split('\n')).toEqual([
      'files="$(node ../../scripts/mutation-shard.mjs . "$SHARD" "$SHARDS")"',
      'echo "shard $SHARD of $SHARDS: $files"',
      'pnpm exec stryker run --mutate "$files"',
      'node ../../scripts/mutation-gate.mjs reports/mutation/mutation.json',
    ]);
    const restore = job.steps.find((s) => String(s.uses ?? '').startsWith('actions/cache/restore@'));
    const save = job.steps.find((s) => String(s.uses ?? '').startsWith('actions/cache/save@'));
    expect(job.steps.indexOf(restore)).toBeLessThan(job.steps.indexOf(run));
    expect(job.steps.indexOf(save)).toBeGreaterThan(job.steps.indexOf(run));
    for (const c of [restore, save])
      expect(c?.with?.path).toBe(`${X} matrix.dir }}/reports/stryker-incremental.json`);
    expect(save?.if).toBe('always()');
    expect(save?.with?.key).toBe(restore?.with?.key);
    const key = String(restore?.with?.key);
    expect(key).toContain(`stryker-${X} matrix.package }}-${X} matrix.shard }}of${X} matrix.shards }}-`);
    expect(key).toContain("format('{0}/test/**', matrix.dir)");
    expect(key).toContain("format('{0}/stryker.config.json', matrix.dir)");
    expect(key).toContain("'scripts/mutation-shard.mjs'");
    expect(key).toContain("hashFiles('packages/*/src/**', 'apps/*/src/**')");
    // a restore falls back only to a run of the same shard over the same tests, never across a test change
    const prefix = String(restore?.with?.['restore-keys']).trim();
    expect(key.startsWith(prefix)).toBe(true);
    expect(prefix).toContain("format('{0}/test/**', matrix.dir)");
    expect(prefix).not.toContain('/src/**');
  });
  it('every package’s Stryker config is incremental into reports/, at concurrency 2, and bails at the first failure', () => {
    for (const dir of [...MUTATED, 'apps/cli']) {
      const cfg = JSON.parse(readFileSync(join(REPO, dir, 'stryker.config.json'), 'utf8'));
      expect(cfg, dir).toMatchObject({
        incremental: true,
        incrementalFile: 'reports/stryker-incremental.json',
        concurrency: 2,
        thresholds: { high: 90, low: 80, break: 80 },
      });
      // why: a mutant is killed by its first failing test, so the run stops there (measured cold: shards ran past an
      // hour without it)
      expect(cfg.commandRunner.command, dir).toMatch(/\s--bail=1(\s|$)/);
    }
  });
  // why: PR #11: a bailed worker killed while it starts a child can leave the child stuck in the kernel; no per-mutant
  // run starts one, and ci.yml runs every file left out on every push
  it.each([...MUTATED, 'apps/cli'])(
    'no per-mutant command in %s runs a test that starts a real process',
    (dir) => {
      const cfg = JSON.parse(readFileSync(join(REPO, dir, 'stryker.config.json'), 'utf8'));
      const words = cfg.commandRunner.command.split(/\s+/);
      const at = words.indexOf('run');
      expect(words.slice(0, at + 1)).toEqual(['pnpm', 'exec', 'vitest', 'run']);
      const excluded = [];
      const filters = [];
      for (let i = at + 1; i < words.length; i++) {
        if (words[i] === '--exclude') excluded.push(words[++i]);
        else if (!words[i].startsWith('-')) filters.push(words[i]);
      }
      const testFiles = (d) =>
        readdirSync(join(REPO, dir, d), { recursive: true, withFileTypes: true })
          .filter((e) => e.isFile() && /\.test\.ts$/.test(e.name))
          .map((e) =>
            join(e.parentPath, e.name)
              .slice(join(REPO, dir).length + 1)
              .split('\\')
              .join('/'),
          );
      const run = testFiles('test').filter(
        (f) => (filters.length === 0 || filters.some((x) => f.includes(x))) && !excluded.includes(f),
      );
      expect(run.length).toBeGreaterThan(0);
      const starting = run.filter((f) =>
        /from 'node:child_process'/.test(readFileSync(join(REPO, dir, f), 'utf8')),
      );
      expect(starting).toEqual([]);
      for (const f of excluded)
        expect(cfg.commandRunner.$comment, `${dir} ${f}`).toContain(f.split('/').pop());
    },
  );
  // why: Ian's ruling (PR #11): GitHub stops a job at 6 hours; the CLI's run is incremental, its results cached, and
  // its cold run must still finish well inside that
  it('the CLI job restores and always saves its incremental file, keyed on its tests and its source, inside 5 hours', () => {
    const job = YAML.parse(t()).jobs['mutate-cli'];
    expect(job['timeout-minutes']).toBeLessThanOrEqual(300);
    const restore = job.steps.find((s) => String(s.uses ?? '').startsWith('actions/cache/restore@'));
    const save = job.steps.find((s) => String(s.uses ?? '').startsWith('actions/cache/save@'));
    for (const c of [restore, save]) expect(c?.with?.path).toBe('apps/cli/reports/stryker-incremental.json');
    expect(save?.if).toBe('always()');
    expect(save?.with?.key).toBe(restore?.with?.key);
    const key = String(restore?.with?.key);
    expect(key).toContain("hashFiles('apps/cli/test/**'");
    expect(key).toContain("hashFiles('apps/cli/src/**'");
    // a restore falls back only to a run over the same tests, never across a test change
    const prefix = String(restore?.with?.['restore-keys']).trim();
    expect(key.startsWith(prefix)).toBe(true);
    expect(prefix).toContain("hashFiles('apps/cli/test/**'");
    expect(prefix).not.toContain("hashFiles('apps/cli/src/**'");
    const cfg = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'apps', 'cli', 'stryker.config.json'), 'utf8'),
    );
    expect(cfg).toMatchObject({
      incremental: true,
      incrementalFile: 'reports/stryker-incremental.json',
      concurrency: 2,
    });
    expect(cfg.commandRunner.command).toContain('test/commands');
    expect(cfg.commandRunner.command).not.toContain('test/real');
    // why: no per-mutant run starts a real child process (PR #11: orphans stuck in the kernel)
    expect(cfg.commandRunner.command).toContain('--exclude test/exec/runner.test.ts');
    expect(cfg.commandRunner.command).toContain('--exclude test/exec/system-children.test.ts');
  });
  it('pnpm mutate runs @gmt/engine, @gmt/api and @gmt/cli mutate beside core and the worker (WP16b, decision 77; WP18)', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
    expect(pkg.scripts.mutate).toBe(
      'pnpm --filter @gmt/core mutate && pnpm --filter @gmt/engine mutate && pnpm --filter @gmt/api mutate && pnpm --filter @gmt/camoufox-worker mutate && pnpm --filter @gmt/cli mutate',
    );
  });
});

// why: decision 72 (WP16b Task 16b.1): the CLI's manifest enters both install stages so the frozen lockfile's importer
// resolves, and both installs filter it out; nothing else of apps/cli reaches the build context, so the image's
// contents are unchanged.
describe('WP16b: the image carries the CLI manifest only, filtered out of both installs', () => {
  const repo = join(import.meta.dirname, '..');
  const dockerfile = readFileSync(join(repo, 'Dockerfile'), 'utf8');
  const stages = dockerfile.split(/^FROM /m).slice(1);
  const stage = (name) => stages.find((s) => s.split('\n')[0].includes(` AS ${name}`)) ?? '';
  it.each(['build', 'prod-deps'])('the %s stage copies apps/cli/package.json before its install', (name) => {
    const s = stage(name);
    const copy = s.indexOf('COPY apps/cli/package.json ./apps/cli/');
    expect(copy).toBeGreaterThan(0);
    expect(copy).toBeLessThan(s.indexOf('pnpm install --frozen-lockfile'));
  });
  it('the build install filters out the CLI beside the worker, and prod-deps installs only the api tree', () => {
    expect(stage('build')).toContain(
      "pnpm install --frozen-lockfile --filter '!@gmt/camoufox-worker' --filter '!@gmt/cli' --store-dir /pnpm/store",
    );
    expect(stage('prod-deps')).toContain('pnpm install --frozen-lockfile --prod --filter "@gmt/api..."');
    expect(stage('runtime')).not.toContain('apps/cli');
  });
  it('.dockerignore admits only the CLI manifest', () => {
    const ignore = readFileSync(join(repo, '.dockerignore'), 'utf8').split('\n');
    expect(ignore).toContain('apps/cli/**');
    expect(ignore).toContain('!apps/cli/package.json');
    expect(ignore.indexOf('!apps/cli/package.json')).toBeGreaterThan(ignore.indexOf('apps/cli/**'));
  });
});

// why: decision 77 (WP16b Task 16b.11): no CI job reads a secret, reaches a host off its job's allowlist, or runs on a
// machine of its own; install-e2e names each runner's mode as a literal, at least one real. The guard parses the YAML.
const INSTALL_JOBS = ['install-e2e', 'camoufox-install'];
const BASE_HOSTS = ['registry.npmjs.org', '127.0.0.1', 'localhost'];
// why: WP16b (decision 77): the test job and install-e2e run on a matrix of pinned images, named in the matrix
// why: WP17 (decision 77): macos-15-intel too, which WP16b's research found for the darwin-x64 entry
const RUNNERS = ['ubuntu-24.04', 'ubuntu-24.04-arm', 'macos-15', 'macos-15-intel', 'windows-2025'];
// why: CodeRabbit …k7_: the one runner expression allowed; its matrix values are checked against RUNNERS
const MATRIX_RUNNER = ['$', '{{ matrix.runner }}'].join('');
/** Why a permissions block grants more than read, or null (sec-b1-004, CodeRabbit …k8D). */
function writeGrant(perms) {
  if (perms === undefined || perms === null) return null;
  if (typeof perms === 'string') return perms === 'read-all' || perms === '{}' ? null : perms;
  const w = Object.entries(perms).filter(([, v]) => v !== 'read' && v !== 'none');
  return w.length === 0 ? null : w.map(([k, v]) => `${k}: ${v}`).join(', ');
}
const RELEASE_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
const REPO = join(import.meta.dirname, '..');
/** The runners WP16b's research record (Task 16b.0) names as lint-only. */
function lintOnlyRunners() {
  const brief = readFileSync(join(REPO, 'docs', 'briefs', 'wp16b-local-setup-cli.md'), 'utf8');
  const record = brief.slice(brief.indexOf('**Research record'), brief.indexOf('### Task 16b.1'));
  return [...record.matchAll(/^\| `([^`]+)`[^|]*\|[^|]*\| `lint-only`/gm)].map((m) => m[1]);
}
const hostsIn = (t) =>
  [...String(t).matchAll(/\bhttps?:\/\/(?:[^\s/@'"`]*@)?([^\s/:'"`)\]]+)/g)].map((m) => m[1].toLowerCase());

/** Every ban the guard enforces, for one workflow's text. */
function guardProblems(
  t,
  ctx = {
    readCi: (p) => (existsSafe(p) ? readFileSync(join(REPO, p), 'utf8') : ''),
    lintOnly: lintOnlyRunners(),
  },
) {
  const out = [];
  const doc = YAML.parse(t) ?? {};
  if (/\bsecrets\s*[.[]|toJSON\(\s*secrets\s*\)|\bsecrets:\s*inherit\b/.test(t))
    out.push('the secrets context');
  const on = doc.on ?? {};
  const triggers = typeof on === 'string' ? [on] : Array.isArray(on) ? on : Object.keys(on);
  for (const bad of ['pull_request_target', 'workflow_run']) if (triggers.includes(bad)) out.push(bad);
  if (doc.permissions?.contents !== 'read') out.push('no top-level permissions: contents: read');
  const topWrite = writeGrant(doc.permissions);
  if (topWrite !== null) out.push(`top-level permissions grant ${topWrite}`);
  const { jobs = {}, ...rest } = doc;
  for (const h of hostsIn(YAML.stringify(rest)))
    if (!BASE_HOSTS.includes(h)) out.push(`host ${h} outside the jobs`);
  for (const [name, job] of Object.entries(jobs)) {
    const jt = YAML.stringify(job);
    const m = job.strategy?.matrix ?? {};
    const runners = [job['runs-on'], ...(m.runner ?? []), ...(m.include ?? []).map((e) => e.runner)]
      .flat()
      .map(String);
    if (runners.some((r) => r.includes('self-hosted'))) out.push(`${name}: a self-hosted runner`);
    const runsOn = job['runs-on'];
    if (runsOn !== undefined) {
      const ro = String(runsOn);
      if (ro.includes('${{') ? ro !== MATRIX_RUNNER : !RUNNERS.includes(ro))
        out.push(`${name}: runs-on ${ro} is not a pinned runner or ${MATRIX_RUNNER}`);
      if (ro === MATRIX_RUNNER)
        for (const r of runners.slice(1))
          if (!RUNNERS.includes(r)) out.push(`${name}: matrix runner ${r} is not a pinned runner`);
    }
    const jobWrite = writeGrant(job.permissions);
    if (jobWrite !== null) out.push(`${name}: job permissions grant ${jobWrite}`);
    if (typeof job.uses === 'string' && !job.uses.startsWith('./') && !/@[0-9a-f]{40}$/.test(job.uses))
      out.push(`${name}: ${job.uses} is not pinned by a full SHA`);
    const install = INSTALL_JOBS.includes(name);
    if (install && /github\.token|GITHUB_TOKEN/.test(jt)) out.push(`${name}: the GitHub token`);
    for (const step of job.steps ?? [])
      if (typeof step.uses === 'string' && !step.uses.startsWith('./') && !/@[0-9a-f]{40}$/.test(step.uses))
        out.push(`${name}: ${step.uses} is not pinned by a full SHA`);
    const allowed = install ? [...BASE_HOSTS, ...RELEASE_HOSTS] : BASE_HOSTS;
    const ci = [...jt.matchAll(/\bci\/[\w.-]+\.json\b/g)].map((x) => x[0]);
    for (const h of [...hostsIn(jt), ...ci.flatMap((p) => hostsIn(ctx.readCi(p)))])
      if (!allowed.includes(h)) out.push(`${name}: host ${h} is off its allowlist`);
    if (name === 'install-e2e') {
      const include = m.include ?? [];
      for (const e of include) {
        const mode = e['E2E-MODE'];
        if (mode !== 'real' && mode !== 'lint-only')
          out.push(`install-e2e: ${e.runner}'s E2E-MODE is not a literal real or lint-only`);
        if (mode === 'lint-only' && !ctx.lintOnly.includes(e.runner))
          out.push(`install-e2e: ${e.runner} is lint-only but WP16b's research record does not name it`);
      }
      if (!include.some((e) => e['E2E-MODE'] === 'real')) out.push('install-e2e: no real entry');
    }
  }
  return out;
}
function existsSafe(p) {
  try {
    readFileSync(join(REPO, p));
    return true;
  } catch {
    return false;
  }
}

describe('WP16b: the workflow guard (decision 77)', () => {
  it.each(files)('%s passes the guard', (f) => {
    expect(guardProblems(text(f))).toEqual([]);
  });

  const SHA = 'a'.repeat(40);
  // why: assembled, so a fixture's GitHub expression is not read as a template placeholder
  const X = ['$', '{{'].join('');
  const ok = (jobs, top = '') =>
    `name: x\non:\n  push: {}\n${top}permissions:\n  contents: read\njobs:\n${jobs}`;
  const step = (body) => `  build:\n    runs-on: ubuntu-24.04\n    steps:\n${body}`;
  const e2e = (include, extra = '') =>
    `  install-e2e:\n    strategy:\n      matrix:\n        include:\n${include}\n    runs-on: \${{ matrix.runner }}\n    steps:\n      - run: echo ok\n${extra}`;
  const ctx = {
    readCi: (p) => (p === 'ci/hosts.json' ? '{"url":"https://evil.example/x"}' : ''),
    lintOnly: [],
  };

  it('a clean fixture passes', () => {
    expect(guardProblems(ok(step('      - run: curl -fsS http://127.0.0.1:3917/api/health\n')), ctx)).toEqual(
      [],
    );
    expect(guardProblems(ok(e2e('          - runner: macos-15\n            E2E-MODE: real')), ctx)).toEqual(
      [],
    );
  });
  it.each([
    ['secrets.X', step(`      - run: echo ${X} secrets.TOKEN }}\n`)],
    ['secrets[...]', step(`      - run: echo ${X} secrets['TOKEN'] }}\n`)],
    ['toJSON(secrets)', step(`      - run: echo ${X} toJSON(secrets) }}\n`)],
  ])('fails on the secrets context: %s', (_n, jobs) => {
    expect(guardProblems(ok(jobs), ctx)).toContain('the secrets context');
  });
  it('fails on secrets: inherit', () => {
    expect(
      guardProblems(ok('  call:\n    uses: ./.github/workflows/x.yml\n    secrets: inherit\n'), ctx),
    ).toContain('the secrets context');
  });
  it.each(['github.token', 'GITHUB_TOKEN'])('fails on %s in install-e2e', (tok) => {
    const t = ok(
      e2e(
        '          - runner: macos-15\n            E2E-MODE: real',
        `      - run: echo ${tok === 'GITHUB_TOKEN' ? '$GITHUB_TOKEN' : `${X} github.token }}`}\n`,
      ),
    );
    expect(guardProblems(t, ctx)).toContain('install-e2e: the GitHub token');
  });
  it.each(['pull_request_target', 'workflow_run'])('fails on %s', (trigger) => {
    const t = ok(step('      - run: echo\n')).replace('  push: {}', `  ${trigger}: {}`);
    expect(guardProblems(t, ctx)).toContain(trigger);
  });
  it('fails on a self-hosted runner', () => {
    expect(
      guardProblems(ok(step('      - run: echo\n').replace('ubuntu-24.04', '[self-hosted, linux]')), ctx),
    ).toContain('build: a self-hosted runner');
  });
  it('fails without top-level permissions: contents: read', () => {
    expect(
      guardProblems(ok(step('      - run: echo\n')).replace('permissions:\n  contents: read\n', ''), ctx),
    ).toContain('no top-level permissions: contents: read');
  });
  it('fails on write permissions at the top or in a job; read and none pass (sec-b1-004, CodeRabbit …k8D)', () => {
    const job = (perms) => `  build:\n    runs-on: ubuntu-24.04\n${perms}    steps:\n      - run: echo\n`;
    expect(guardProblems(ok(job('    permissions:\n      contents: write\n')), ctx)).toContain(
      'build: job permissions grant contents: write',
    );
    expect(guardProblems(ok(job('    permissions:\n      id-token: write\n')), ctx)).toContain(
      'build: job permissions grant id-token: write',
    );
    expect(guardProblems(ok(job('    permissions: write-all\n')), ctx)).toContain(
      'build: job permissions grant write-all',
    );
    expect(
      guardProblems(ok(job('    permissions:\n      contents: read\n      actions: none\n')), ctx),
    ).toEqual([]);
    expect(
      guardProblems(
        ok(job('')).replace(
          'permissions:\n  contents: read\n',
          'permissions:\n  contents: read\n  packages: write\n',
        ),
        ctx,
      ),
    ).toContain('top-level permissions grant packages: write');
  });
  it('fails on a reusable workflow not pinned by a full SHA; a local one passes (sec-b1-004)', () => {
    expect(guardProblems(ok('  call:\n    uses: o/r/.github/workflows/x.yml@main\n'), ctx)).toContain(
      'call: o/r/.github/workflows/x.yml@main is not pinned by a full SHA',
    );
    expect(guardProblems(ok(`  call:\n    uses: o/r/.github/workflows/x.yml@${SHA}\n`), ctx)).toEqual([]);
    expect(guardProblems(ok('  call:\n    uses: ./.github/workflows/x.yml\n'), ctx)).toEqual([]);
  });
  it('fails on a runner expression other than the matrix runner, and on an unpinned matrix value (CodeRabbit …k7_)', () => {
    expect(
      guardProblems(ok(step('      - run: echo\n').replace('ubuntu-24.04', `${X} vars.RUNNER }}`)), ctx),
    ).toContain(`build: runs-on ${X} vars.RUNNER }} is not a pinned runner or ${X} matrix.runner }}`);
    expect(
      guardProblems(ok(step('      - run: echo\n').replace('ubuntu-24.04', 'ubuntu-latest')), ctx),
    ).toContain(`build: runs-on ubuntu-latest is not a pinned runner or ${X} matrix.runner }}`);
    expect(
      guardProblems(ok(e2e('          - runner: ubuntu-latest\n            E2E-MODE: real')), ctx),
    ).toContain('install-e2e: matrix runner ubuntu-latest is not a pinned runner');
  });
  it('fails on an action not pinned by a 40-character SHA', () => {
    expect(guardProblems(ok(step('      - uses: actions/checkout@v7\n')), ctx)).toContain(
      'build: actions/checkout@v7 is not pinned by a full SHA',
    );
    expect(guardProblems(ok(step(`      - uses: actions/checkout@${SHA}\n`)), ctx)).toEqual([]);
  });
  it('fails on a host off its job’s allowlist: anywhere, a release host in another job, and in a ci/*.json a step names', () => {
    expect(guardProblems(ok(step('      - run: curl https://example.com/x\n')), ctx)).toContain(
      'build: host example.com is off its allowlist',
    );
    expect(guardProblems(ok(step('      - run: curl https://github.com/x/y/releases/z\n')), ctx)).toContain(
      'build: host github.com is off its allowlist',
    );
    expect(
      guardProblems(
        ok(
          e2e(
            '          - runner: macos-15\n            E2E-MODE: real',
            '      - run: curl https://github.com/x\n',
          ),
        ),
        ctx,
      ),
    ).toEqual([]);
    expect(guardProblems(ok(step('      - run: node x.mjs ci/hosts.json\n')), ctx)).toContain(
      'build: host evil.example is off its allowlist',
    );
    expect(
      guardProblems(ok(step('      - run: echo\n'), 'env:\n  U: https://evil.example\n'), ctx),
    ).toContain('host evil.example outside the jobs');
  });
  it('fails on a computed E2E-MODE, on a matrix with no real entry, and on a lint-only runner the record does not name', () => {
    expect(
      guardProblems(ok(e2e(`          - runner: macos-15\n            E2E-MODE: ${X} inputs.mode }}`)), ctx),
    ).toContain("install-e2e: macos-15's E2E-MODE is not a literal real or lint-only");
    const lint = ok(e2e('          - runner: macos-15\n            E2E-MODE: lint-only'));
    expect(guardProblems(lint, ctx)).toEqual([
      "install-e2e: macos-15 is lint-only but WP16b's research record does not name it",
      'install-e2e: no real entry',
    ]);
    expect(guardProblems(lint, { ...ctx, lintOnly: ['macos-15'] })).toEqual(['install-e2e: no real entry']);
  });
  it('the research record names no lint-only runner today', () => {
    expect(lintOnlyRunners()).toEqual([]);
  });
});

describe('WP16b: the CI matrix, install-e2e and the Windows leg (decisions 77, 78)', () => {
  const ci = () => YAML.parse(text('ci.yml'));
  it('test runs on the four pinned runners, without continue-on-error', () => {
    const job = ci().jobs.test;
    expect(job.strategy.matrix.runner).toEqual([
      'ubuntu-24.04',
      'ubuntu-24.04-arm',
      'macos-15',
      'windows-2025',
    ]);
    expect(text('ci.yml')).not.toContain('continue-on-error');
  });
  it('the Windows leg writes vitest JSON results and its verdict is the known-failures script’s', () => {
    const steps = ci().jobs.test.steps.map((s) => `${s.if ?? ''} :: ${s.run ?? s.uses ?? ''}`);
    const win = steps.filter((s) => s.startsWith("runner.os == 'Windows'"));
    expect(win.join('\n')).toContain('--reporter=default --reporter=json --outputFile=vitest-results.json');
    expect(win.join('\n')).toContain(
      'node scripts/windows-known-failures.mjs guard vitest-list.json --results vitest-results.json',
    );
    expect(win.join('\n')).toContain('node scripts/windows-known-failures.mjs check vitest-results.json');
    expect(win.join('\n')).toContain('pnpm gmt setup --dry-run --answers ci/answers.e2e.template.json');
    // why: ts-b1-009: a crash after partial output must not leave the check reading an older file
    const run = ci().jobs.test.steps.find((s) =>
      String(s.run ?? '').includes('--outputFile=vitest-results.json'),
    );
    expect(String(run?.run).trim().split('\n')[0]).toBe('rm -f vitest-results.json vitest-list.json');
  });
  it('install-e2e: the three runners real, a timeout, read-only permissions, setup, status, update, uninstall, logs on failure', () => {
    const job = ci().jobs['install-e2e'];
    expect(job.strategy.matrix.include).toEqual([
      { runner: 'ubuntu-24.04', 'E2E-MODE': 'real' },
      { runner: 'ubuntu-24.04-arm', 'E2E-MODE': 'real' },
      { runner: 'macos-15', 'E2E-MODE': 'real' },
    ]);
    expect(job['timeout-minutes']).toBe(30);
    expect(job.permissions).toEqual({ contents: 'read' });
    const runs = job.steps.map((s) => s.run ?? '').join('\n');
    for (const s of [
      'echo "E2E-MODE: $E2E_MODE"',
      'git init --bare',
      // why: a local clone's hardlinks race git's background maintenance (seen on ubuntu-24.04-arm)
      'git clone --no-local "$RUNNER_TEMP/origin.git" "$RUNNER_TEMP/gmt"',
      'pnpm gmt setup --non-interactive --answers "$RUNNER_TEMP/answers.json"',
      'curl -fsS http://127.0.0.1:3917/api/health',
      "grep -E '^backups +ok'",
      'pnpm gmt update',
      'pnpm -s gmt uninstall --non-interactive',
    ])
      expect(runs).toContain(s);
    expect(runs).not.toMatch(/gmt smoke/);
    // why: dev-b1-012: recovery after a hard kill, a restart, and a backup restored, on every real runner
    for (const s of [
      'kill -9 "$pid"',
      'pnpm gmt restart',
      'pnpm -s gmt backup',
      'pnpm gmt restore "$file"',
      // why: ts-b1-010: the removed lines are counted, the services are gone and the port is closed
      'test "$(grep -c \'^removed: \' "$RUNNER_TEMP/uninstall.txt")" -ge 3',
      'if curl -fsS --max-time 5 http://127.0.0.1:3917/api/health; then echo "the app still answers"; exit 1; fi',
    ])
      expect(runs).toContain(s);
    // why: Ian's rule (PR #11): the job waits on events, never a poll or a fixed sleep: the user manager's start job,
    // and the app's own "listening" log line after the step that (re)starts it
    expect(runs).not.toMatch(/seq 1|sleep \d|until /);
    for (const s of [
      'sudo systemctl start "user@$(id -u).service"',
      'node scripts/after-app-listening.mjs -- kill -9 "$pid"',
      'node scripts/after-app-listening.mjs -- pnpm gmt restart',
      'node scripts/after-app-listening.mjs -- pnpm gmt start',
    ])
      expect(runs).toContain(s);
    // why: ts-b1-011: lint-only means something: setup only plans, and every later step that needs services is skipped
    const at = job.steps.findIndex((s) => s.name === 'setup');
    expect(job.steps[at].run).toContain('if [ "$E2E_MODE" = lint-only ]; then');
    expect(job.steps[at].run).toContain(
      'pnpm gmt setup --dry-run --non-interactive --answers "$RUNNER_TEMP/answers.json"',
    );
    for (const s of job.steps.slice(at + 1))
      expect(s.if, s.name ?? s.uses).toBe(s.if === 'failure()' ? 'failure()' : "env.E2E_MODE == 'real'");
    expect(
      job.steps.some(
        (s) => s.if === 'failure()' && String(s.uses ?? '').startsWith('actions/upload-artifact@'),
      ),
    ).toBe(true);
    expect(JSON.parse(readFileSync(join(REPO, 'ci', 'answers.e2e.template.json'), 'utf8'))).toMatchObject({
      port: 3917,
      linger: 'enable',
    });
  });
});

// why: WP17 Task 17.9 (decision 77): the camoufox-install job, on the pin's and the install code's changes and weekly
describe('WP17: the camoufox-install job', () => {
  const wf = () => YAML.parse(text('camoufox-install.yml'));
  const PATHS = [
    'packages/core/src/camoufox/**',
    'packages/core/src/local/paths.ts',
    'apps/cli/src/camoufox/**',
    'apps/cli/src/commands/browser.ts',
    'apps/cli/src/exec/**',
    'apps/cli/src/plan/**',
    'apps/cli/src/platform/**',
    'apps/camoufox-worker/src/install.ts',
    'apps/camoufox-worker/src/launch.ts',
    'apps/camoufox-worker/src/fonts.ts',
    'apps/camoufox-worker/src/run.ts',
    'apps/camoufox-worker/src/paths.ts',
    'apps/camoufox-worker/src/platform.ts',
    'apps/camoufox-worker/package.json',
    'apps/camoufox-worker/test/install.smoke.test.ts',
    'apps/camoufox-worker/test/support/seamChild.ts',
    'pnpm-lock.yaml',
    '.github/workflows/camoufox-install.yml',
  ];
  it('runs on the pin’s, the install code’s and the smoke’s paths, and weekly', () => {
    const on = wf().on;
    expect(on.push.paths).toEqual(PATHS);
    expect(on.pull_request.paths).toEqual(PATHS);
    expect(on.schedule).toEqual([{ cron: '23 5 * * 1' }]);
  });
  it('covers each pinned entry’s runner, Intel macOS included, with a timeout and read-only permissions', () => {
    const job = wf().jobs['camoufox-install'];
    expect(job.strategy.matrix.runner).toEqual([
      'ubuntu-24.04',
      'ubuntu-24.04-arm',
      'macos-15',
      'macos-15-intel',
    ]);
    expect(job['timeout-minutes']).toBe(45);
    expect(job.permissions).toEqual({ contents: 'read' });
  });
  it('installs with the operator’s command, each attempt under its own timeout, then checks the digest and the loopback launch', () => {
    const steps = wf().jobs['camoufox-install'].steps;
    const installs = steps.filter((s) => String(s.run ?? '') === 'pnpm gmt browser install --keep-archive');
    expect(installs).toHaveLength(2);
    expect(installs.map((s) => s['timeout-minutes'])).toEqual([15, 15]);
    expect(installs[0]['continue-on-error']).toBe(true);
    expect(installs[1].if).toBe(`steps.${installs[0].id}.outcome == 'failure'`);
    expect(
      steps.some((s) => String(s.run ?? '').includes('the bundle does not name the pinned digest')),
    ).toBe(true);
    const smoke = steps.at(-1);
    expect(smoke.env).toEqual({ CAMOUFOX_INSTALL_SMOKE: '1' });
    expect(String(smoke.run)).toContain('test/install.smoke.test.ts');
    const names = steps.map((s) => s.name ?? s.uses ?? s.run);
    expect(names.indexOf(installs[1].name)).toBeLessThan(names.indexOf(smoke.name));
  });
  it('caches the downloaded archive only, per runner and digest; the weekly run restores nothing and only it or main saves', () => {
    const steps = wf().jobs['camoufox-install'].steps;
    const restore = steps.find((s) => String(s.uses ?? '').startsWith('actions/cache/restore@'));
    const save = steps.find((s) => String(s.uses ?? '').startsWith('actions/cache/save@'));
    // why: the YAML's own expressions, spelled without a template placeholder in this source
    const ex = (s) => ['$', `{{ ${s} }}`].join('');
    const key = `camoufox-archive-${ex('steps.pin.outputs.key')}-${ex('steps.pin.outputs.sha256')}`;
    const path = `~/.local/share/get-me-there/camoufox/${ex('steps.pin.outputs.archive')}`;
    expect([restore.with.key, save.with.key]).toEqual([key, key]);
    expect([restore.with.path, save.with.path]).toEqual([path, path]);
    expect(restore.if).toBe("github.event_name != 'schedule'");
    expect(save.if).toBe(
      "steps.cache.outputs.cache-hit != 'true' && (github.event_name == 'schedule' || github.ref == 'refs/heads/main')",
    );
  });
  it('the release hosts are allowed in this job only: the same step under another job name fails', () => {
    const wfText = (job) =>
      `on: push\npermissions:\n  contents: read\njobs:\n  ${job}:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: curl -fsSL https://release-assets.githubusercontent.com/x -o x.zip\n`;
    expect(guardProblems(wfText('camoufox-install'))).toEqual([]);
    expect(guardProblems(wfText('build'))).toContain(
      'build: host release-assets.githubusercontent.com is off its allowlist',
    );
  });
});

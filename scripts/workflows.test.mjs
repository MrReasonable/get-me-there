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
  const RUNNERS = ['ubuntu-24.04', 'ubuntu-24.04-arm', 'macos-15', 'windows-2025'];
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
      const named = [...(m?.runner ?? []), ...(m?.include ?? []).map((e) => e.runner)];
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
  it('runs the mutation-glob check, then pnpm mutate', () => {
    const runs = [...t().matchAll(/^\s*- run: (.+)$/gm)].map((m) => m[1]);
    expect(runs).toEqual([
      'pnpm install --frozen-lockfile',
      'node scripts/check-mutation-globs.mjs',
      'pnpm mutate',
    ]);
  });
  it('pnpm mutate runs @gmt/engine and @gmt/cli mutate beside core and the worker (WP16b, decision 77)', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
    expect(pkg.scripts.mutate).toBe(
      'pnpm --filter @gmt/core mutate && pnpm --filter @gmt/engine mutate && pnpm --filter @gmt/camoufox-worker mutate && pnpm --filter @gmt/cli mutate',
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
      'pnpm gmt setup --non-interactive --answers "$RUNNER_TEMP/answers.json"',
      'curl -fsS http://127.0.0.1:3917/api/health',
      "grep -E '^backups +ok'",
      'pnpm gmt update',
      'pnpm -s gmt uninstall --non-interactive',
    ])
      expect(runs).toContain(s);
    expect(runs).not.toMatch(/gmt smoke/);
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

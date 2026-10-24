import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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
  it.each(files)('%s pins actions by SHA at Node 24 releases and runners to ubuntu-24.04', (f) => {
    const t = text(f);
    expect(pinProblems(t)).toEqual([]);
    expect([...t.matchAll(/^\s*(?:-\s+)?uses:/gm)].length).toBeGreaterThan(0);
    const runners = [...t.matchAll(/^\s*runs-on: (\S+)/gm)].map((m) => m[1]);
    expect(runners.length).toBeGreaterThan(0);
    for (const r of runners) expect(r).toBe('ubuntu-24.04');
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
  it('pnpm mutate runs @gmt/engine mutate beside core and the worker', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
    expect(pkg.scripts.mutate).toBe(
      'pnpm --filter @gmt/core mutate && pnpm --filter @gmt/engine mutate && pnpm --filter @gmt/camoufox-worker mutate',
    );
  });
});

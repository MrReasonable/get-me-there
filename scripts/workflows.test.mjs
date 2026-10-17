import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
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

  it('greps with explicit -e patterns', () => {
    expect(patterns.length).toBeGreaterThan(1);
  });

  it.each([
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

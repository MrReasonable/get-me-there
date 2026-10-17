import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// why: review wp12-security I1 — a workflow without a permissions block runs with the repository's default token scope,
// which may be read-write. Every workflow must say what it needs, and none may ask to write (decision 63).
const DIR = join(import.meta.dirname, '..', '.github', 'workflows');
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
const text = (f) => readFileSync(join(DIR, f), 'utf8');

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

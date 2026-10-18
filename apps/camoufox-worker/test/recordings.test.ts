// The recordings backup and restore (2026-10-18): recordings live in a worktree's gitignored tree, so a removed
// worktree would take them with it. Synthetic files in temporary directories only.
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  backupDir,
  backupRecordings,
  localDay,
  recordingsMain,
  restoreRecordings,
} from '../src/recordings.js';
import { tmpDir } from './support/tmp.js';

beforeEach(() => {
  expect.hasAssertions();
});

const mode = (p: string): number => statSync(p).mode & 0o777;

/** A recorded tree as a checkout holds it: tracked .gitkeep files and local recordings, some loosely moded. */
function tree(): string {
  const root = tmpDir();
  for (const k of ['results', 'cheapest', 'graph-explore']) {
    mkdirSync(join(root, k), { recursive: true });
    writeFileSync(join(root, k, '.gitkeep'), '');
  }
  mkdirSync(join(root, 'results', '2026-10-18'), { mode: 0o755 });
  writeFileSync(join(root, 'results', '2026-10-18', '1.facts.json'), '{"a":1}\n', { mode: 0o644 });
  writeFileSync(join(root, 'results', '2026-10-18', '1.meta.json'), '{"b":2}\n', { mode: 0o600 });
  mkdirSync(join(root, 'graph-explore', '2026-10-18'));
  writeFileSync(join(root, 'graph-explore', '2026-10-18', '1.json'), '{"c":3}\n');
  return root;
}

describe('backupRecordings', () => {
  it('copies every recording but .gitkeep, directories 0700 and files 0600, and never follows a link', () => {
    const root = tree();
    symlinkSync('/etc/hosts', join(root, 'results', 'link.json'));
    const dest = join(tmpDir(), 'private', 'fixtures', 'camoufox-2026-10-18');
    expect(backupRecordings(root, dest)).toBe(3);
    expect(readFileSync(join(dest, 'results/2026-10-18/1.facts.json'), 'utf8')).toBe('{"a":1}\n');
    expect(readFileSync(join(dest, 'graph-explore/2026-10-18/1.json'), 'utf8')).toBe('{"c":3}\n');
    expect(existsSync(join(dest, 'results/.gitkeep'))).toBe(false);
    expect(existsSync(join(dest, 'results/link.json'))).toBe(false);
    // why: a kind with only its .gitkeep makes no directory in the backup
    expect(existsSync(join(dest, 'cheapest'))).toBe(false);
    for (const d of [dest, join(dest, 'results'), join(dest, 'results/2026-10-18')])
      expect(mode(d), d).toBe(0o700);
    for (const f of ['results/2026-10-18/1.facts.json', 'results/2026-10-18/1.meta.json'])
      expect(mode(join(dest, f)), f).toBe(0o600);
  });
  it('a second backup the same day adds what is new and keeps what was there', () => {
    const root = tree();
    const dest = join(tmpDir(), 'camoufox-2026-10-18');
    backupRecordings(root, dest);
    writeFileSync(join(dest, 'results/2026-10-18/9.facts.json'), 'kept');
    writeFileSync(join(root, 'results', '2026-10-18', '2.facts.json'), '{"d":4}\n');
    expect(backupRecordings(root, dest)).toBe(4);
    expect(readFileSync(join(dest, 'results/2026-10-18/9.facts.json'), 'utf8')).toBe('kept');
    expect(mode(join(dest, 'results/2026-10-18/2.facts.json'))).toBe(0o600);
  });
});

describe('restoreRecordings', () => {
  it('copies a backup into an empty tree (only .gitkeep files), directories 0700 and files 0600', () => {
    const src = join(tmpDir(), 'camoufox-2026-10-18');
    backupRecordings(tree(), src);
    const root = tmpDir();
    mkdirSync(join(root, 'results'));
    writeFileSync(join(root, 'results', '.gitkeep'), '');
    expect(restoreRecordings(src, root)).toBe(3);
    expect(readFileSync(join(root, 'results/2026-10-18/1.meta.json'), 'utf8')).toBe('{"b":2}\n');
    expect(existsSync(join(root, 'results', '.gitkeep'))).toBe(true);
    expect(mode(join(root, 'results/2026-10-18'))).toBe(0o700);
    expect(mode(join(root, 'graph-explore/2026-10-18/1.json'))).toBe(0o600);
  });
  it('refuses a tree that already holds a recording, and a backup that does not exist', () => {
    const src = join(tmpDir(), 'camoufox-2026-10-18');
    backupRecordings(tree(), src);
    expect(() => restoreRecordings(src, tree())).toThrow(/not empty/);
    expect(() => restoreRecordings(join(tmpDir(), 'missing'), tmpDir())).toThrow(/no backup/);
  });
});

describe('recordingsMain', () => {
  const run = (argv: string[], o: { home: string; root: string; today?: string }) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = recordingsMain(argv, {
      home: o.home,
      root: o.root,
      today: o.today ?? '2026-10-18',
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    });
    return { code, out, err };
  };
  it('backs up into ~/.local/share/get-me-there/private/fixtures/camoufox-<date>/ and restores the latest backup', () => {
    const home = tmpDir();
    const a = run(['backup'], { home, root: tree() });
    expect(a.code).toBe(0);
    expect(backupDir(home, '2026-10-18')).toBe(
      join(home, '.local/share/get-me-there/private/fixtures/camoufox-2026-10-18'),
    );
    expect(a.out.join()).toMatch(/3 files.*camoufox-2026-10-18/);
    run(['backup'], { home, root: tree(), today: '2026-10-17' });
    const root = tmpDir();
    const b = run(['restore'], { home, root });
    expect(b.code).toBe(0);
    expect(b.out.join()).toMatch(/camoufox-2026-10-18/);
    expect(existsSync(join(root, 'results/2026-10-18/1.facts.json'))).toBe(true);
  });
  it('restores a named date, and says plainly when there is nothing to do or the arguments are wrong', () => {
    const home = tmpDir();
    run(['backup'], { home, root: tree(), today: '2026-10-17' });
    expect(run(['restore', '2026-10-17'], { home, root: tmpDir() }).code).toBe(0);
    expect(run(['restore', '2026-10-16'], { home, root: tmpDir() }).err.join()).toMatch(/no backup/);
    expect(run(['restore'], { home: tmpDir(), root: tmpDir() }).err.join()).toMatch(/no backup/);
    expect(run(['restore', 'yesterday'], { home, root: tmpDir() }).code).toBe(78);
    expect(run(['wipe'], { home, root: tmpDir() }).code).toBe(78);
    const empty = run(['backup'], { home, root: tmpDir() });
    expect([empty.code, empty.out.join()]).toEqual([0, 'no recordings to back up']);
  });
});

describe('localDay', () => {
  it('is the local calendar date, zero-padded', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

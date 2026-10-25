import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { systemFiles } from '../../src/exec/files.js';
import { MemoryFs } from '../../src/exec/memory.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// why: the two Files implementations must report the same facts for the same tree, so a planner tested on MemoryFs
// behaves the same on the real disk
describe.skipIf(process.platform === 'win32')('systemFiles and MemoryFs agree (POSIX modes)', () => {
  it('report text, mode, owner, size, directories, symlinks and listings alike', () => {
    const d = mkdtempSync(join(tmpdir(), 'gmt-files-'));
    dirs.push(d);
    mkdirSync(join(d, 'sub'));
    chmodSync(join(d, 'sub'), 0o700);
    writeFileSync(join(d, 'sub', 'a.env'), 'A=1\n');
    chmodSync(join(d, 'sub', 'a.env'), 0o600);
    symlinkSync(join(d, 'sub'), join(d, 'link'));
    const uid = process.getuid?.() ?? 0;
    const mem = new MemoryFs(uid)
      .dir(d, 0o755)
      .dir(join(d, 'sub'), 0o700)
      .file(join(d, 'sub', 'a.env'), 'A=1\n', 0o600);
    mem.symlink(join(d, 'link'), join(d, 'sub'));
    for (const f of [systemFiles, mem]) {
      expect(f.read(join(d, 'sub', 'a.env'))).toBe('A=1\n');
      expect(f.read(join(d, 'sub'))).toBeNull();
      expect(f.read(join(d, 'none'))).toBeNull();
      expect(f.mode(join(d, 'sub', 'a.env'))).toBe(0o600);
      expect(f.mode(join(d, 'sub'))).toBe(0o700);
      expect(f.mode(join(d, 'none'))).toBeNull();
      expect(f.owner(join(d, 'sub', 'a.env'))).toBe(uid);
      expect(f.owner(join(d, 'none'))).toBeNull();
      expect(f.size(join(d, 'sub', 'a.env'))).toBe(4);
      expect(f.size(join(d, 'sub'))).toBeNull();
      expect(f.isDir(join(d, 'sub'))).toBe(true);
      expect(f.isDir(join(d, 'link'))).toBe(true);
      expect(f.isDir(join(d, 'sub', 'a.env'))).toBe(false);
      expect(f.isSymlink(join(d, 'link'))).toBe(true);
      expect(f.isSymlink(join(d, 'sub'))).toBe(false);
      expect(f.list(d)).toEqual(['link', 'sub']);
      expect(f.list(join(d, 'sub', 'a.env'))).toBeNull();
      expect(f.writable(join(d, 'sub'))).toBe(true);
      expect(f.writable(join(d, 'none'))).toBe(false);
      expect(f.read(join(d, 'link', 'a.env'))).toBe(f === mem ? null : 'A=1\n');
    }
  });
});

// why: U8 (ca-b1-009): only "no such file" reads as absent; a file this user cannot read is an error, so setup never
// mistakes an unreadable app.env for a missing one and writes a new one over it
describe.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('unreadable is not absent', () => {
  it('systemFiles.read throws for a file it may not read, and returns null only when there is none', () => {
    const d = mkdtempSync(join(tmpdir(), 'gmt-files-'));
    dirs.push(d);
    writeFileSync(join(d, 'locked.env'), 'A=1\n');
    chmodSync(join(d, 'locked.env'), 0o000);
    expect(() => systemFiles.read(join(d, 'locked.env'))).toThrow(/EACCES|permission/i);
    expect(systemFiles.read(join(d, 'none'))).toBeNull();
    expect(systemFiles.read(join(d, 'none', 'deeper'))).toBeNull();
    expect(systemFiles.mode(join(d, 'locked.env'))).toBe(0);
  });
  it('MemoryFs can stand in for an unreadable file', () => {
    const fs = new MemoryFs().file('/a', 'x').unreadable('/a');
    expect(() => fs.read('/a')).toThrow('EACCES');
    expect(fs.mode('/a')).toBe(0o644);
  });
});

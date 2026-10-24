import { describe, expect, it } from 'vitest';
import { readSetupRecord, recordAction, setupRecordPath } from '../../src/setup/record.js';
import { testWorld } from '../support/deps.js';

// why: U4 (po-b1-002): "already native" is a finished install, not an app.env on disk; an import in progress is recorded
describe('the setup record', () => {
  it('absent or unreadable JSON is a fresh machine', () => {
    const w = testWorld();
    expect(readSetupRecord(w.deps)).toEqual({ linger: 'skip', installed: false, import: null, moved: false });
    w.fs.file(setupRecordPath(w.deps), '{ not json');
    expect(readSetupRecord(w.deps)).toEqual({ linger: 'skip', installed: false, import: null, moved: false });
    w.fs.file(setupRecordPath(w.deps), '{"linger":"sometimes"}');
    expect(readSetupRecord(w.deps)).toEqual({ linger: 'skip', installed: false, import: null, moved: false });
  });
  it('reads what it wrote; the write is planned only when it differs', () => {
    const w = testWorld();
    const r = { linger: 'enable' as const, installed: true, import: 'docker' as const, moved: true };
    const a = recordAction(w.deps, r);
    expect(a).toMatchObject({ kind: 'writeFile', path: setupRecordPath(w.deps), mode: 0o644, secret: false });
    if (a === null || a.kind !== 'writeFile') throw new Error('no write');
    w.fs.file(a.path, a.contents);
    expect(readSetupRecord(w.deps)).toEqual(r);
    expect(recordAction(w.deps, r)).toBeNull();
  });
  it('an older record holding only linger is read with its linger', () => {
    const w = testWorld();
    w.fs.file(setupRecordPath(w.deps), '{"linger":"enable"}\n');
    expect(readSetupRecord(w.deps)).toEqual({
      linger: 'enable',
      installed: false,
      import: null,
      moved: false,
    });
  });
});

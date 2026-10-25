import { describe, expect, it } from 'vitest';
import {
  backupAction,
  checkAction,
  lockFree,
  markerBesideAction,
  placeActions,
  printedBackup,
  startNote,
} from '../../src/setup/importDb.js';
import { testWorld } from '../support/deps.js';

// why: Ian's ruling on PR #11 (survivors before merge): the placement, the backup's printed file, the lock and the
// first-start note, at unit level, since Stryker's per-mutant command leaves the real-SQLite suite out.
const DB = '/Users/op/.local/share/get-me-there/get-me-there.db';

describe('importDb: the placement and its steps', () => {
  it('without keepAs the current database is left to the backup taken before: copy, check, both side files, rename', () => {
    const w = testWorld();
    w.fs.file(DB, 'current', 0o600);
    const a = placeActions(w.deps, '/b/x.db');
    const show = (x: (typeof a)[number]): string => {
      if (x.kind === 'run') return `run ${x.argv.slice(1).join(' ')}`;
      if (x.kind === 'copy' || x.kind === 'rename') return `${x.kind} ${x.from} ${x.to}`;
      if (x.kind === 'remove') return `remove ${x.path}`;
      return x.kind;
    };
    expect(a.map(show)).toEqual([
      `copy /b/x.db ${DB}.importing`,
      `run /repo/scripts/check-backup.mjs ${DB}.importing`,
      `remove ${DB}-wal`,
      `remove ${DB}-shm`,
      `rename ${DB}.importing ${DB}`,
    ]);
    expect(a.filter((x) => x.kind === 'remove').every((x) => x.kind === 'remove' && !x.recursive)).toBe(true);
  });
  it('the check is check-backup.mjs on the copy, with the child environment, named for the operator', () => {
    const w = testWorld();
    expect(checkAction(w.deps, '/f.db')).toEqual({
      kind: 'run',
      argv: ['/opt/node/bin/node', '/repo/scripts/check-backup.mjs', '/f.db'],
      cwd: '/repo',
      describe: 'check /f.db with PRAGMA integrity_check (scripts/check-backup.mjs)',
      env: w.deps.childEnv,
    });
  });
  it('the backup is backup.mjs with the database named, its extra words only when given, and the child environment', () => {
    const w = testWorld();
    const b = backupAction(w.deps, DB, '/d');
    expect(b.kind === 'run' && b.argv).toEqual([
      '/opt/node/bin/node',
      '/repo/scripts/backup.mjs',
      '--db',
      DB,
      '--dir',
      '/d',
    ]);
    expect(b.kind === 'run' && b.env).toEqual(w.deps.childEnv);
    const k = backupAction(w.deps, DB, '/d', ['--keep', '5']);
    expect(k.kind === 'run' && k.argv.slice(-2)).toEqual(['--keep', '5']);
  });
  it('the marker beside a moved database is no secret', () => {
    const w = testWorld();
    expect(markerBesideAction(w.deps, '/w/data/dev.db')).toMatchObject({
      kind: 'writeFile',
      path: '/w/data/MOVED-TO-NATIVE',
      secret: false,
      mode: 0o644,
    });
  });
});

describe('importDb: the file the backup printed', () => {
  const NO = { ok: false, error: 'the backup did not print the file it wrote' };
  it('accepts its one JSON line naming a .db file directly in the directory', () => {
    expect(printedBackup('noise\n{"ok":true,"file":"/d/get-me-there-x.db"}\n', '/d')).toEqual({
      ok: true,
      file: '/d/get-me-there-x.db',
    });
  });
  it.each([
    ['no JSON', 'backup written\n'],
    ['another shape', '{"ok":false,"file":"/d/x.db"}\n'],
    ['a file elsewhere', '{"ok":true,"file":"/elsewhere/x.db"}\n'],
    ['a file in a sub-directory', '{"ok":true,"file":"/d/sub/x.db"}\n'],
    ['a name with a space', '{"ok":true,"file":"/d/bad name.db"}\n'],
    ['a name that is no .db', '{"ok":true,"file":"/d/x.db.txt"}\n'],
  ])('refuses %s', (_n, out) => {
    expect(printedBackup(out, '/d')).toEqual(NO);
  });
});

describe('importDb: the source’s lock', () => {
  const at = (code: number, stdout: string) => {
    const w = testWorld({
      run: (argv) => (String(argv[1]).endsWith('lock-state.mjs') ? { code, stdout } : undefined),
    });
    return w;
  };
  it('reads lock-state.mjs with the child environment; absent and stale are free', async () => {
    for (const state of ['absent', 'stale']) {
      const w = at(0, `${JSON.stringify({ state })}\n`);
      expect(await lockFree(w.deps, '/w/dev.db')).toEqual({ ok: true });
      expect(w.runner.calls[0]?.argv).toEqual([
        '/opt/node/bin/node',
        '/repo/scripts/lock-state.mjs',
        '/w/dev.db',
      ]);
      expect(w.runner.calls[0]?.env).toEqual(w.deps.childEnv);
    }
  });
  it('a fresh lock refuses, naming who holds it', async () => {
    expect(await lockFree(at(0, '{"state":"fresh"}').deps, '/w/dev.db')).toEqual({
      ok: false,
      error: 'an app or a tool is using /w/dev.db (its lock is held): stop it, then run setup again',
    });
  });
  it.each([
    ['a failed run, even with a state printed', 1, '{"state":"absent"}'],
    ['no JSON', 0, 'oops'],
    ['an unknown state', 0, '{"state":"maybe"}'],
  ])('%s is not free: the lock cannot be read', async (_n, code, out) => {
    expect(await lockFree(at(code, out).deps, '/w/dev.db')).toEqual({
      ok: false,
      error: 'cannot read the lock of /w/dev.db',
    });
  });
});

describe('importDb: the first-start note', () => {
  it('says nothing when there is nothing to resume or catch up, or no summary', () => {
    expect(startNote({ resumable: 0, scheduled: 0 })).toBe('');
    expect(startNote(null)).toBe('');
  });
  it('names only what there is, and joins both with a space', () => {
    expect(startNote({ resumable: 0, scheduled: 2 })).toBe(
      '2 scheduled searches may each catch up their latest missed firing once when the app starts; those runs spend calls like any other.\n',
    );
    expect(startNote({ resumable: 1, scheduled: 0 })).toBe(
      'Starting the app resumes 1 unfinished run from this database (set AUTO_RESUME=false in app.env first to leave them for you to resume or cancel).\n',
    );
    expect(startNote({ resumable: 2, scheduled: 1 }, 'now')).toBe(
      "The app now starts on this database and resumes 2 unfinished runs it holds (cancel them from the app's status bar if you did not want them). 1 scheduled search may catch up its latest missed firing once when the app starts; that run spends calls like any other.\n",
    );
  });
});

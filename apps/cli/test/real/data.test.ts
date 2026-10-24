import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { parseMovedMarker } from '@gmt/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { databasePath } from '../../src/services/specs.js';
import { inspect, interrupting, REPO, realDeps, sampleDb } from './support.js';

// why: spec §9 item 9: the data-loss paths run for real in a temporary directory: a SQLite database with rows,
// backed up by scripts/backup.mjs, imported or restored, reopened and counted. Nothing here runs a service manager or
// docker: those commands are answered by the test's runner (test/real/support.ts).
const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
beforeAll(() => {
  execFileSync(process.execPath, [join(REPO, 'scripts', 'ensure-build.mjs')], {
    cwd: REPO,
    stdio: 'ignore',
    timeout: 1_200_000,
  });
}, 1_200_000);
const temp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  homes.push(d);
  return d;
};
const NI = (answers: string) => ['--non-interactive', '--answers', answers];
const answers = (dir: string, body: unknown = {}) => {
  const p = join(dir, 'answers.json');
  writeFileSync(p, JSON.stringify(body), { mode: 0o600 });
  return p;
};
const sides = (db: string) => [`${db}-wal`, `${db}-shm`].filter((p) => existsSync(p));

describe.skipIf(process.platform === 'win32')(
  'real data: imports and restore (Tasks 16b.7, 16b.8)',
  { timeout: 300_000 },
  () => {
    it('--import-db: a WAL source with 100 executions, some only in its -wal, arrives whole and checked', async () => {
      const src = temp('gmt-src-');
      const writer = sampleDb(join(src, 'dev.db'), 100, 30);
      try {
        expect(existsSync(join(src, 'dev.db-wal'))).toBe(true);
        const { deps, home } = realDeps({ home: temp('gmt-home-') });
        expect(await runCli(['setup', '--import-db', join(src, 'dev.db'), ...NI(answers(home))], deps)).toBe(
          0,
        );
        const db = databasePath(deps.platform.paths);
        expect(inspect(db)).toEqual({ rows: 100, ok: 'ok' });
        expect(sides(db)).toEqual([]);
        expect(parseMovedMarker(readFileSync(join(src, 'MOVED-TO-NATIVE'), 'utf8'))).toBe(
          '2026-10-24T09:30:00.000Z',
        );
        expect(readdirSync(deps.platform.paths.data).filter((n) => n.includes('.importing'))).toEqual([]);
      } finally {
        writer.close();
      }
    });

    it('--import-docker over a stand-in volume: backed up, copied out, restored, checked, then marked', async () => {
      const volume = temp('gmt-volume-');
      mkdirSync(join(volume, 'backups'));
      sampleDb(join(volume, 'get-me-there.db'), 100, 0).close();
      const { deps, home } = realDeps({ home: temp('gmt-home-'), volume });
      writeFileSync(join(home, 'answers.json'), '{}', { mode: 0o600 });
      expect(await runCli(['setup', '--import-docker', ...NI(join(home, 'answers.json'))], deps)).toBe(0);
      expect(inspect(databasePath(deps.platform.paths))).toEqual({ rows: 100, ok: 'ok' });
      expect(parseMovedMarker(readFileSync(join(volume, 'MOVED-TO-NATIVE'), 'utf8'))).toBe(
        '2026-10-24T09:30:00.000Z',
      );
    });

    it('interrupted before or after any step, or mid-copy, the native database is absent, the old or the new one, never partial', async () => {
      const src = temp('gmt-src-');
      sampleDb(join(src, 'dev.db'), 100, 0).close();
      const outcomes = new Set<string>();
      for (const replace of [false, true])
        for (const when of ['before', 'after', 'partial-copy'] as const)
          for (let at = 0; at < 14; at++) {
            const home = temp('gmt-home-');
            const first = realDeps({ home });
            if (replace) {
              mkdirSync(first.deps.platform.paths.data, { recursive: true, mode: 0o700 });
              sampleDb(databasePath(first.deps.platform.paths), 7, 0).close();
            }
            const x = realDeps({ home, executor: (e) => interrupting(e, at, when) });
            const args = [
              'setup',
              '--import-db',
              join(src, 'dev.db'),
              ...(replace ? ['--replace-database'] : []),
              ...NI(answers(home)),
            ];
            await runCli(args, x.deps);
            const db = databasePath(x.deps.platform.paths);
            const left = sides(db);
            const state = inspect(db);
            expect(state === null || state.ok === 'ok').toBe(true);
            expect(state === null ? null : state.rows).toSatisfy(
              (n: number | null) => n === null || n === 100 || (replace && n === 7),
            );
            // why: no -wal or -shm ever sits beside the new database (or beside none); the old one may keep the pair
            // its own pre-replace backup opened, which belongs to it and leaves it intact (checked above)
            if (state === null || state.rows === 100)
              expect({ at, when, replace, left }).toEqual({ at, when, replace, left: [] });
            outcomes.add(state === null ? 'absent' : state.rows === 100 ? 'new' : 'old');
            if (replace && state?.rows === 100) {
              const kept = readdirSync(join(x.deps.platform.paths.data, 'backups'))
                .filter((n) => n.endsWith('.db'))
                .map((n) => inspect(join(x.deps.platform.paths.data, 'backups', n))?.rows);
              expect(kept).toContain(7);
            }
          }
      expect([...outcomes].sort()).toEqual(['absent', 'new', 'old']);
    });

    it('restore: refuses a source failing integrity_check; else keeps the current file as .before-restore and puts the backup in place 0600', async () => {
      const { deps, home, io } = realDeps({ home: temp('gmt-home-') });
      expect(await runCli(['setup', ...NI(answers(home))], deps)).toBe(0);
      const db = databasePath(deps.platform.paths);
      sampleDb(db, 5, 0).close();
      writeFileSync(`${db}-wal`, '');
      writeFileSync(`${db}-shm`, '');
      const bad = join(home, 'bad.db');
      writeFileSync(bad, 'this is not a database');
      expect(await runCli(['restore', bad], deps)).toBe(78);
      expect(inspect(db)?.rows).toBe(5);
      const src = temp('gmt-src-');
      sampleDb(join(src, 'good.db'), 100, 20).close();
      expect(await runCli(['restore', join(src, 'good.db')], deps)).toBe(0);
      expect(inspect(db)).toEqual({ rows: 100, ok: 'ok' });
      expect(inspect(`${db}.before-restore`)?.rows).toBe(5);
      expect(sides(db)).toEqual([]);
      expect((await import('node:fs')).statSync(db).mode & 0o777).toBe(0o600);
      expect(io.stdout).toContain('check each vendor’s dashboard');
    });
  },
);

describe.skipIf(process.platform === 'win32')(
  'no secret reaches any output (systemExecutor, temporary HOME)',
  { timeout: 120_000 },
  () => {
    it('a full setup with every secret set leaks none into stdout, stderr, argv or the rendered service files', async () => {
      const home = temp('gmt-home-');
      const log: string[] = [];
      const { deps, io } = realDeps({ home, log });
      const sentinels = {
        tp: 'SENTINEL-real-tp-1234',
        sa: 'SENTINEL-real-sa-5678',
        smtp: 'SENTINEL-real-smtp-90',
      };
      const a = answers(home, {
        travelpayouts: { token: sentinels.tp },
        searchApi: { plan: '40usd', key: sentinels.sa },
        email: {
          host: 'smtp.example.com',
          port: 465,
          tls: 'implicit',
          user: 'u',
          pass: sentinels.smtp,
          to: 'a@example.com',
          from: 'b@example.com',
        },
      });
      expect(await runCli(['setup', '--dry-run', ...NI(a)], deps)).toBe(0);
      expect(await runCli(['setup', ...NI(a)], deps)).toBe(0);
      const env = readFileSync(join(deps.platform.paths.config, 'app.env'), 'utf8');
      const pass = parseEnv(env).APP_BASIC_AUTH_PASS ?? 'missing';
      const services = readdirSync(deps.platform.paths.serviceDir).map((f) =>
        readFileSync(join(deps.platform.paths.serviceDir, f), 'utf8'),
      );
      expect(services.length).toBeGreaterThan(0);
      for (const s of [...Object.values(sentinels), pass])
        for (const out of [io.stdout, io.stderr, ...log, ...services]) {
          expect(out).not.toContain(s);
          expect(out).not.toContain(Buffer.from(s).toString('base64url'));
        }
      expect(
        (await import('node:fs')).statSync(join(deps.platform.paths.config, 'app.env')).mode & 0o777,
      ).toBe(0o600);
    });
  },
);

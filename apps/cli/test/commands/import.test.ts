import { MOVED_MARKER, parseMovedMarker } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import type { Action } from '../../src/plan/action.js';
import { scriptedAsk, stubHttp, testIo } from '../support/deps.js';
import { dockerStandIn } from '../support/docker.js';
import { machine } from '../support/machine.js';

const DATA = '/Users/op/.local/share/get-me-there';
const DB = `${DATA}/get-me-there.db`;
const NOW = '2026-10-24T09:30:00.000Z';
const ACTIVE = {
  execution: {
    id: 'e1',
    definitionId: 'd1',
    definitionName: 'London to New York weekly',
    kind: 'run',
    startedAt: '2026-10-24T09:00:00.000Z',
    estimatedFinishAt: '2026-10-24T10:15:00.000Z',
  },
};
const COMPOSE_ENV =
  'APP_BASIC_AUTH_USER=ci\nAPP_BASIC_AUTH_PASS=compose-pass-0123\nTRAVELPAYOUTS_TOKEN=compose-tp-0123456789\nSCHEDULER_TIMEZONE=America/New_York\nALLOWED_HOSTS=nas.local:3000\n';

function dockerMachine(
  opts: {
    active?: unknown[];
    running?: boolean;
    backupFails?: boolean;
    checkFails?: boolean;
    ask?: ReturnType<typeof scriptedAsk>;
  } = {},
) {
  const answers = [...(opts.active ?? [{ execution: null }])];
  const http = stubHttp({
    'GET /api/executions/active': () => ({
      status: 200,
      body: answers.length > 1 ? answers.shift() : answers[0],
    }),
  });
  let docker: ReturnType<typeof dockerStandIn> | undefined;
  const m = machine({
    http,
    ...(opts.ask ? { ask: opts.ask } : {}),
    extra: (argv, call) => {
      if (opts.checkFails && String(argv[1]).endsWith('check-backup.mjs'))
        return { code: 74, stderr: 'integrity_check failed' };
      return docker?.handler(argv, call);
    },
  });
  docker = dockerStandIn(m.fs, {
    ...(opts.running === undefined ? {} : { running: opts.running }),
    ...(opts.backupFails ? { backupFails: true } : {}),
  });
  m.fs.file('/repo/.env', COMPOSE_ENV, 0o600);
  m.fs.file('/work/a.json', '{}', 0o600);
  return { ...m, docker, http };
}
const argvs = (m: ReturnType<typeof machine>) => m.runner.calls.map((c) => c.argv.join(' '));
const idx = (list: string[], pred: (s: string) => boolean) => list.findIndex(pred);
const NI = ['--non-interactive', '--answers', '/work/a.json'];

describe('--import-docker (spec §13 "One app per ledger"; brief Task 16b.7)', () => {
  it('reads the compose .env, checks the container’s runs with its credentials, stops it, backs up, copies, restores, checks, then marks', async () => {
    const m = dockerMachine();
    expect(await runCli(['setup', '--import-docker', ...NI], m.deps)).toBe(0);
    const req = m.http.requests[0];
    expect(req?.url).toBe('http://127.0.0.1:3000/api/executions/active');
    expect(req?.headers.Authorization).toBe(
      `Basic ${Buffer.from('ci:compose-pass-0123').toString('base64')}`,
    );
    const a = argvs(m);
    const stop = idx(a, (s) => s.endsWith('compose -p get-me-there stop app'));
    const backup = idx(a, (s) => s.includes('scripts/backup.mjs --dir /data/backups'));
    const cp = idx(a, (s) =>
      s.includes(`cp app:${m.docker.FILE} ${DATA}/backups/get-me-there-2026-10-24T09-30-00-000Z.db`),
    );
    const check = idx(a, (s) => s.includes('check-backup.mjs') && s.endsWith(`${DB}.importing`));
    const marker = idx(a, (s) => s.includes('--entrypoint sh app -c cat > /data/MOVED-TO-NATIVE'));
    expect([stop, backup, cp, check, marker].every((i) => i >= 0)).toBe(true);
    expect(stop).toBeLessThan(backup);
    expect(backup).toBeLessThan(cp);
    expect(cp).toBeLessThan(check);
    expect(check).toBeLessThan(marker);
    expect(a.slice(0, stop).some((s) => s.includes('backup.mjs'))).toBe(false);
    // the restored database is in place, 0600, from the copy; no temporary file is left
    expect(m.fs.read(DB)).toBe('sqlite copy from the volume');
    expect(m.fs.mode(DB)).toBe(0o600);
    expect(m.fs.read(`${DB}.importing`)).toBeNull();
    // the marker is core's text for the move's instant, through stdin
    expect(parseMovedMarker(m.docker.state.marker ?? '')).toBe(NOW);
    // run with -T and --no-deps; the shell formats nothing
    const markerCall = m.runner.calls[marker];
    expect(markerCall?.argv).toEqual([
      'docker',
      'compose',
      '-p',
      'get-me-there',
      'run',
      '--rm',
      '-T',
      '--no-deps',
      '--entrypoint',
      'sh',
      'app',
      '-c',
      'cat > /data/MOVED-TO-NATIVE',
    ]);
    expect(markerCall?.argv.join(' ')).not.toMatch(/date|touch/);
    // down is offered and taken by default, never with -v
    expect(m.docker.state.down).toBe(true);
    expect(a.some((s) => s.includes('down -v'))).toBe(false);
    expect(m.io.stdout).toContain('caps would count twice');
    // the native app starts only after the database is in place
    expect(
      idx(a, (s) => s.includes('launchctl bootstrap gui/501') && s.includes('app.plist')),
    ).toBeGreaterThan(marker);
  });

  it('refuses while the container runs a search, naming it and its estimated finish; nothing is stopped', async () => {
    const m = dockerMachine({ active: [ACTIVE] });
    expect(await runCli(['setup', '--import-docker', ...NI], m.deps)).toBe(75);
    expect(m.io.stderr).toContain(
      'a search is running in the Docker app: London to New York weekly, started 2026-10-24T09:00:00.000Z, estimated to finish 2026-10-24T10:15:00.000Z',
    );
    expect(argvs(m).some((s) => s.includes('stop app'))).toBe(false);
    expect(m.executor.log).toEqual([]);
  });

  it('--wait polls every 60 s until no run is active', async () => {
    const slept: number[] = [];
    const m = dockerMachine({ active: [ACTIVE, ACTIVE, { execution: null }] });
    m.deps.sleep = async (ms) => {
      slept.push(ms);
    };
    expect(await runCli(['setup', '--import-docker', '--wait', ...NI], m.deps)).toBe(0);
    expect(slept.filter((s) => s === 60_000)).toHaveLength(2);
  });

  it('a stopped container is not asked; its run cannot be active', async () => {
    const m = dockerMachine({ running: false });
    expect(await runCli(['setup', '--import-docker', ...NI], m.deps)).toBe(0);
    expect(m.http.requests).toEqual([]);
  });

  it('a failed integrity check plans no marker and no rename; a failed backup copies nothing', async () => {
    const m = dockerMachine({ checkFails: true });
    expect(await runCli(['setup', '--import-docker', ...NI], m.deps)).toBe(1);
    expect(m.docker.state.marker).toBeNull();
    expect(m.fs.read(DB)).toBeNull();
    const b = dockerMachine({ backupFails: true });
    expect(await runCli(['setup', '--import-docker', ...NI], b.deps)).toBe(1);
    expect(argvs(b).some((s) => s.includes(' cp '))).toBe(false);
    expect(b.docker.state.marker).toBeNull();
    // why: dev-b1-006: each failure says what state it left and the way back
    expect(m.io.stderr).toContain('The native database is unchanged and the old one is not marked moved.');
    expect(m.io.stderr).toContain('to go back to it, run docker compose start app');
    expect(b.io.stderr).toContain(
      'The database was not moved. The Docker app is stopped; to go back to it, run docker compose start app.',
    );
  });
  it('a failure after the marker names the state and the way forward; a plain setup re-run then finishes (dev-b1-006)', async () => {
    const m = dockerMachine();
    const exec = m.deps.executor;
    let failHealth = true;
    m.deps.executor = {
      run: async (a) => {
        if (a.kind === 'waitHealthy' && failHealth) throw new Error('not healthy within 240 s');
        return exec.run(a);
      },
    };
    expect(await runCli(['setup', '--import-docker', ...NI], m.deps)).toBe(1);
    expect(m.docker.state.marker).not.toBeNull();
    expect(m.io.stderr).toContain('The database is in place here and the old one is marked moved');
    expect(m.io.stderr).toContain(
      'docker compose run --rm --no-deps --entrypoint rm app /data/MOVED-TO-NATIVE',
    );
    expect(m.io.stderr).toContain('See pnpm gmt logs, then run pnpm gmt setup to finish.');
    failHealth = false;
    m.io.stderr = '';
    expect(await runCli(['setup', ...NI], m.deps)).toBe(0);
    expect(m.io.stderr).not.toContain('--replace-database');
  });

  it('interactive: each .env group is confirmed; ALLOWED_HOSTS is shown, not copied; values never printed', async () => {
    const ask = scriptedAsk([true, false, '', '', '', '', false, true, false]);
    const m = dockerMachine({ ask });
    const io = testIo({ tty: true });
    m.deps.io = io;
    m.fs.file('/work/a.json', '{}', 0o600);
    expect(await runCli(['setup', '--import-docker'], m.deps)).toBe(0);
    expect(ask.asked.slice(0, 2)).toEqual([
      'Carry the Travelpayouts lines (TRAVELPAYOUTS_TOKEN) from the Docker .env into app.env?',
      'Carry the time zone (SCHEDULER_TIMEZONE) from the Docker .env into app.env?',
    ]);
    const env = m.fs.read('/Users/op/.config/get-me-there/app.env') ?? '';
    expect(env).toContain('TRAVELPAYOUTS_TOKEN="compose-tp-0123456789"');
    expect(env).not.toContain('America/New_York');
    expect(env).not.toContain('ALLOWED_HOSTS');
    // why: CodeRabbit PRRT_kwDOVNmjjs6v7k7l: asserted unconditionally on the io the command wrote to
    expect(io.stdout).toContain('ALLOWED_HOSTS=nas.local:3000; it is not copied');
    expect(io.stdout).not.toContain('compose-tp-0123456789');
    expect(io.stdout).not.toContain('compose-pass-0123');
    expect(ask.asked).toContain(
      'Stop and remove the Docker app’s container now (docker compose down, the volume kept)?',
    );
  });

  it('a native database already present refuses unless --replace-database, which backs it up before anything is copied in', async () => {
    const m = dockerMachine();
    m.fs.file(DB, 'native', 0o600);
    expect(await runCli(['setup', '--import-docker', ...NI], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('--replace-database');
    expect(argvs(m).some((s) => s.includes('stop app'))).toBe(false);
    expect(await runCli(['setup', '--import-docker', '--replace-database', ...NI], m.deps)).toBe(0);
    const a = argvs(m);
    const nativeBackup = idx(a, (s) => s.includes(`backup.mjs --db ${DB} --dir ${DATA}/backups`));
    expect(nativeBackup).toBeGreaterThanOrEqual(0);
    expect(nativeBackup).toBeLessThan(idx(a, (s) => s.includes('scripts/backup.mjs --dir /data/backups')));
    expect(m.fs.read(DB)).toBe('sqlite copy from the volume');
  });
});

describe('--import-db <path> and --ignore-docker', () => {
  const SRC = '/work/checkout/data/dev.db';
  function dbMachine(lock: string, summary?: { resumable: number; scheduled: number }) {
    const m = machine({
      extra: (argv) => {
        const s = String(argv[1]);
        if (summary !== undefined && s.endsWith('check-backup.mjs'))
          return { code: 0, stdout: `${JSON.stringify({ ok: true, file: argv[2], ...summary })}\n` };
        if (s.endsWith('lock-state.mjs')) return { code: 0, stdout: `${JSON.stringify({ state: lock })}\n` };
        if (s.endsWith('backup.mjs') && argv.includes('--db') && argv.includes(SRC)) {
          m.fs.file(`${DATA}/backups/get-me-there-x.db`, 'checkout backup', 0o600);
          return {
            code: 0,
            stdout: `${JSON.stringify({ ok: true, file: `${DATA}/backups/get-me-there-x.db` })}\n`,
          };
        }
        return undefined;
      },
    });
    m.fs.file(SRC, 'checkout db', 0o644).file('/work/a.json', '{}', 0o600);
    return m;
  }
  it('backs the checkout database up, restores and checks it natively, then writes the marker beside it', async () => {
    const m = dbMachine('absent');
    expect(await runCli(['setup', '--import-db', SRC, ...NI], m.deps)).toBe(0);
    expect(m.fs.read(DB)).toBe('checkout backup');
    const marker = m.executor.log.find(
      (a): a is Extract<Action, { kind: 'writeFile' }> =>
        a.kind === 'writeFile' && a.path === `/work/checkout/data/${MOVED_MARKER}`,
    );
    expect(parseMovedMarker(marker?.contents ?? '')).toBe(NOW);
    const log = m.executor.log;
    const markerAt = log.findIndex(
      (a) => a.kind === 'writeFile' && a.path === `/work/checkout/data/${MOVED_MARKER}`,
    );
    expect(log.findIndex((a) => a.kind === 'run' && a.describe.startsWith('check'))).toBeLessThan(markerAt);
  });
  it('says what the first start resumes and catches up from the imported database (cb-b1-010)', async () => {
    const m = dbMachine('absent', { resumable: 2, scheduled: 1 });
    expect(await runCli(['setup', '--import-db', SRC, ...NI], m.deps)).toBe(0);
    expect(m.io.stdout).toContain(
      'The app now starts on this database and resumes 2 unfinished runs it holds',
    );
    expect(m.io.stdout).toContain('1 scheduled search may catch up its latest missed firing once');
    expect(m.io.stdout.indexOf('resumes 2 unfinished runs')).toBeLessThan(
      m.io.stdout.indexOf('User name: operator'),
    );
  });
  it('refuses while the checkout’s app holds its lock', async () => {
    const m = dbMachine('fresh');
    expect(await runCli(['setup', '--import-db', SRC, ...NI], m.deps)).toBe(75);
    expect(m.io.stderr).toContain('its lock is held');
    expect(m.fs.read(DB)).toBeNull();
  });
  it('with --replace-database a held lock refuses before any stop, backup or write: only the build ran (ca-b1-003, CodeRabbit …k7Z)', async () => {
    const m = dbMachine('fresh');
    m.fs.file(DB, 'native db', 0o600);
    expect(await runCli(['setup', '--import-db', SRC, '--replace-database', ...NI], m.deps)).toBe(75);
    const done = m.executor.log.map((a) => (a.kind === 'run' ? a.argv.join(' ') : a.kind));
    expect(done).toContain('pnpm build');
    expect(done.every((d) => d.startsWith('pnpm install') || d.startsWith('pnpm build'))).toBe(true);
    expect(m.fs.read(DB)).toBe('native db');
  });
  it('refuses a path that is no file', async () => {
    const m = dbMachine('absent');
    expect(await runCli(['setup', '--import-db', '/nope.db', ...NI], m.deps)).toBe(78);
  });

  it('--ignore-docker stops the container and writes the marker into the volume, importing nothing', async () => {
    const m = dockerMachine();
    expect(await runCli(['setup', '--ignore-docker', ...NI], m.deps)).toBe(0);
    const a = argvs(m);
    expect(idx(a, (s) => s.endsWith('stop app'))).toBeLessThan(
      idx(a, (s) => s.includes('cat > /data/MOVED-TO-NATIVE')),
    );
    expect(parseMovedMarker(m.docker.state.marker ?? '')).toBe(NOW);
    expect(a.some((s) => s.includes('backup.mjs'))).toBe(false);
    expect(m.fs.read(DB)).toBeNull();
  });
});

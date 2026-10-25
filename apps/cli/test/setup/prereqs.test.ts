import { describe, expect, it } from 'vitest';
import { gatherPrereqs, judgePrereqs, type PrereqFacts } from '../../src/setup/prereqs.js';
import { testWorld } from '../support/deps.js';

const base = (over: Partial<PrereqFacts> = {}): PrereqFacts => ({
  os: 'darwin',
  uid: 501,
  nodeVersion: '22.18.0',
  nodeDir: '/opt/homebrew/opt/node@22/bin',
  nodeDirWritable: true,
  pnpm: true,
  corepack: true,
  git: true,
  port: null,
  manager: 'ok',
  journalPersistent: true,
  ...over,
});
const problemOf = (f: PrereqFacts) => judgePrereqs(f).problems.map((p) => `${p.message} | ${p.fix ?? ''}`);

describe('prerequisites (spec §13 "Prerequisites are checked before anything is written")', () => {
  it('a ready machine passes with no notes', () => {
    expect(judgePrereqs(base())).toEqual({ problems: [], notes: [] });
  });

  it('Node 22.17 fails with brew install node@22 on macOS', () => {
    expect(problemOf(base({ nodeVersion: '22.17.9' }))).toEqual([
      'Node 22.17.9 is older than 22.18 | brew install node@22',
    ]);
  });
  it('on Linux the fix is the distribution’s or NodeSource’s package, never a curl-pipe', () => {
    const [p] = problemOf(base({ os: 'linux', nodeVersion: '20.11.0' }));
    expect(p).toContain('Node 20.11.0 is older than 22.18');
    expect(p).toContain('NodeSource');
    expect(p).not.toMatch(/curl|\| *(ba)?sh/);
  });
  it.each(['22.18.0', '22.20.1', '24.0.0', '26.12.0'])('Node %s passes', (v) => {
    expect(problemOf(base({ nodeVersion: v }))).toEqual([]);
  });

  it('no pnpm with corepack present: corepack enable', () => {
    expect(problemOf(base({ pnpm: false }))).toEqual(['pnpm is not on PATH | corepack enable']);
  });
  it('no pnpm where Node’s directory is not writable: corepack enable --install-directory ~/.local/bin, with the PATH note', () => {
    expect(problemOf(base({ pnpm: false, nodeDirWritable: false }))).toEqual([
      'pnpm is not on PATH | corepack enable --install-directory ~/.local/bin (then add ~/.local/bin to PATH)',
    ]);
  });
  it('no pnpm and no corepack: install corepack first', () => {
    expect(problemOf(base({ pnpm: false, corepack: false }))).toEqual([
      'pnpm is not on PATH and corepack is missing | npm install --global corepack, then corepack enable',
    ]);
  });
  it('no git: the OS’s fix', () => {
    expect(problemOf(base({ git: false }))).toEqual(['git is not installed | xcode-select --install']);
    expect(problemOf(base({ os: 'linux', git: false }))).toEqual([
      'git is not installed | install the distribution’s git package',
    ]);
  });

  it('the chosen port busy offers the next free one', () => {
    expect(problemOf(base({ port: { wanted: 3000, free: false, nextFree: 3001 } }))).toEqual([
      'port 3000 is in use on 127.0.0.1 | choose 3001 (the next free port)',
    ]);
    expect(problemOf(base({ port: { wanted: 3000, free: false, nextFree: null } }))[0]).toContain(
      'choose another port',
    );
    expect(problemOf(base({ port: { wanted: 3000, free: true, nextFree: null } }))).toEqual([]);
  });

  it('macOS without a GUI session (over SSH)', () => {
    expect(problemOf(base({ manager: 'no-gui' }))).toEqual([
      'no GUI session (for example over SSH) | log in at the Mac, or turn on automatic login for a Mac that must run unattended',
    ]);
  });
  it('Linux with no user bus, and with no systemd', () => {
    expect(problemOf(base({ os: 'linux', uid: 1000, manager: 'no-bus' }))).toEqual([
      'the systemd user manager does not answer (no user bus) | log in through a proper session, or set XDG_RUNTIME_DIR=/run/user/1000',
    ]);
    expect(problemOf(base({ os: 'linux', manager: 'no-systemd' }))).toEqual([
      'this setup needs systemd | use the container path (docs/setup.md section 1)',
    ]);
  });
  it('Linux with /var/log/journal absent prints the persistence note, not a failure', () => {
    const r = judgePrereqs(base({ os: 'linux', journalPersistent: false }));
    expect(r.problems).toEqual([]);
    expect(r.notes).toEqual([
      'the journal is not persistent, so the app’s logs go at a reboot; to keep them: sudo mkdir -p /var/log/journal && sudo systemctl restart systemd-journald',
    ]);
  });
});

describe('gatherPrereqs reads every fact before any action', () => {
  it('macOS: reads through the runner only, and nothing is applied', async () => {
    const w = testWorld({
      run: (argv) =>
        argv[0] === 'launchctl' ? { code: 113 } : argv[0] === 'git' ? { code: 127 } : undefined,
      deps: { portFree: async (p) => p !== 3000 },
    });
    w.fs.dir('/opt/node/bin', 0o755);
    const f = await gatherPrereqs(w.deps, 3000);
    expect(f).toEqual({
      os: 'darwin',
      uid: 501,
      nodeVersion: '22.18.0',
      nodeDir: '/opt/node/bin',
      nodeDirWritable: true,
      pnpm: true,
      corepack: true,
      git: false,
      port: { wanted: 3000, free: false, nextFree: 3001 },
      manager: 'no-gui',
      journalPersistent: true,
    });
    expect(w.executor.log).toEqual([]);
    expect(w.runner.calls.map((c) => c.argv)).toEqual([
      ['pnpm', '--version'],
      ['corepack', '--version'],
      ['git', '--version'],
      ['launchctl', 'print', 'gui/501'],
    ]);
  });

  it('Linux: systemctl absent is no-systemd; show-environment failing with systemd present is no-bus', async () => {
    const absent = testWorld({ os: 'linux', run: (a) => (a[0] === 'systemctl' ? { code: 127 } : undefined) });
    expect((await gatherPrereqs(absent.deps, null)).manager).toBe('no-systemd');
    const noBus = testWorld({ os: 'linux', run: (a) => (a[0] === 'systemctl' ? { code: 1 } : undefined) });
    noBus.fs.dir('/run/systemd/system');
    const f = await gatherPrereqs(noBus.deps, null);
    expect([f.manager, f.journalPersistent, f.port]).toEqual(['no-bus', false, null]);
    const ok = testWorld({ os: 'linux' });
    ok.fs.dir('/run/systemd/system').dir('/var/log/journal');
    expect(await gatherPrereqs(ok.deps, null)).toMatchObject({ manager: 'ok', journalPersistent: true });
  });

  it('a Node directory the user cannot write is reported', async () => {
    const w = testWorld();
    w.fs.dir('/opt/node/bin', 0o755).chown('/opt/node/bin', 0);
    expect((await gatherPrereqs(w.deps, null)).nodeDirWritable).toBe(false);
  });
});

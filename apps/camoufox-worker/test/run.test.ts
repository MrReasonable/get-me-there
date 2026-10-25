import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkEnvFiles,
  type Entry,
  EX_CONFIG,
  EX_SOFTWARE,
  INSTALL_DIR_INHERITED,
  installDirSetting,
  main,
  resolveDataDir,
  run,
} from '../src/run.js';
import { tmpDir } from './support/tmp.js';

const uid = process.getuid?.() ?? 0;
const asRoot = uid === 0;
function dataDir(o: { dirMode?: number; fileMode?: number | null } = {}): string {
  const d = join(tmpDir(), 'camoufox');
  mkdirSync(d);
  chmodSync(d, o.dirMode ?? 0o700);
  if (o.fileMode !== null) {
    writeFileSync(join(d, 'worker.env'), 'CAMOUFOX_WORKER_KEY=synthetic-worker-key-0123456789abcdef\n');
    chmodSync(join(d, 'worker.env'), o.fileMode ?? 0o600);
  }
  return d;
}
function deps(env: Record<string, string | undefined>, over: Partial<Parameters<typeof run>[1]> = {}) {
  const loaded: string[] = [];
  const errs: string[] = [];
  const ran: string[][] = [];
  const envs: Array<Record<string, string | undefined>> = [];
  const entry: Entry = async (ctx) => {
    ran.push(ctx.args);
    envs.push({ ...ctx.env });
    return 0;
  };
  return {
    loaded,
    errs,
    ran,
    envs,
    d: {
      env,
      uid,
      readEnvFile: (p: string) => {
        loaded.push(p);
        return readFileSync(p, 'utf8');
      },
      entries: { status: async () => entry, 'capture-socs': async () => entry },
      withoutEnvFile: new Set(['capture-socs']),
      out: () => undefined,
      err: (l: string) => {
        errs.push(l);
      },
      ...over,
    },
  };
}

beforeEach(() => {
  expect.hasAssertions();
});

describe('a refusal before any entry runs explains itself (W1, dev-b1-003)', () => {
  const refusalOf = (dir: string): unknown => {
    try {
      return JSON.parse(readFileSync(join(dir, 'start-refusal.json'), 'utf8'));
    } catch {
      return null;
    }
  };
  it('main leaves a config refusal in its data directory; check prints one; other commands write nothing', async () => {
    const dir = dataDir({ fileMode: 0o644 });
    const out: string[] = [];
    const t = deps({ CAMOUFOX_DATA_DIR: dir }, { out: (l: string) => out.push(l), entries: {} });
    expect(await run(['main'], { ...t.d, entries: { main: async () => async () => 0 } })).toBe(EX_CONFIG);
    expect(refusalOf(dir)).toMatchObject({ reason: 'config' });
    expect(t.errs.join()).toMatch(/0600/);
    const other = dataDir({ fileMode: 0o644 });
    const c = deps({ CAMOUFOX_DATA_DIR: other }, { out: (l: string) => out.push(l) });
    expect(await run(['check', '--json'], { ...c.d, entries: { check: async () => async () => 0 } })).toBe(
      EX_CONFIG,
    );
    expect(JSON.parse(out.at(-1) ?? '')).toMatchObject({ reason: 'config' });
    expect(refusalOf(other)).toBeNull();
    const status = dataDir({ fileMode: 0o644 });
    expect(await run(['status'], deps({ CAMOUFOX_DATA_DIR: status }).d)).toBe(EX_CONFIG);
    expect(refusalOf(status)).toBeNull();
  });
  // why: CodeRabbit (PR #15): an inherited CAMOUFOX_INSTALL_DIR is refused by run() too, so it leaves its file
  it('an inherited CAMOUFOX_INSTALL_DIR under main leaves a config refusal; under check prints one', async () => {
    const dir = dataDir();
    const out: string[] = [];
    const t = deps(
      { CAMOUFOX_DATA_DIR: dir, CAMOUFOX_INSTALL_DIR: '/elsewhere' },
      { out: (l: string) => out.push(l) },
    );
    expect(await run(['main'], { ...t.d, entries: { main: async () => async () => 0 } })).toBe(EX_CONFIG);
    expect(refusalOf(dir)).toMatchObject({ reason: 'config' });
    expect(t.errs.join()).toContain(INSTALL_DIR_INHERITED);
    expect(await run(['check', '--json'], { ...t.d, entries: { check: async () => async () => 0 } })).toBe(
      EX_CONFIG,
    );
    expect(JSON.parse(out.at(-1) ?? '')).toMatchObject({ reason: 'config' });
  });
  it('a data directory that is not there, or not a directory of this user’s, gets no file', async () => {
    const gone = join(tmpDir(), 'gone');
    expect(
      await run(['main'], {
        ...deps({ CAMOUFOX_DATA_DIR: gone }).d,
        entries: { main: async () => async () => 0 },
      }),
    ).toBe(EX_CONFIG);
    expect(refusalOf(gone)).toBeNull();
    const theirs = dataDir({ fileMode: 0o644 });
    const { statSync } = await import('node:fs');
    const foreign = (p: string) => {
      const st = statSync(p);
      return { mode: st.mode, uid: uid + 1, isDirectory: () => st.isDirectory(), isFile: () => st.isFile() };
    };
    expect(
      await run(['main'], {
        ...deps({ CAMOUFOX_DATA_DIR: theirs }).d,
        stat: foreign,
        entries: { main: async () => async () => 0 },
      }),
    ).toBe(EX_CONFIG);
    expect(refusalOf(theirs)).toBeNull();
  });
});

describe('run.ts (SEC-R2-006: one env file, its mode checked on the file loaded)', () => {
  it('loads the checked path and dispatches', async () => {
    const dir = dataDir();
    const t = deps({ CAMOUFOX_DATA_DIR: dir });
    expect(await run(['status', '--x'], t.d)).toBe(0);
    expect(t.loaded).toEqual([join(dir, 'worker.env')]);
    expect(t.ran).toEqual([['--x']]);
  });
  // why: fix round 1 (sec I1): worker.env is the one source; the inherited environment never overrides it
  it('the entry sees the file’s values plus HOME, PATH, TMPDIR and CAMOUFOX_DATA_DIR only', async () => {
    const dir = dataDir();
    const env = { CAMOUFOX_DATA_DIR: dir, HOME: '/Users/op', PATH: '/bin', TMPDIR: '/t', FOO: 'shell' };
    const t = deps(env);
    expect(await run(['status'], t.d)).toBe(0);
    expect(t.envs).toEqual([
      {
        CAMOUFOX_DATA_DIR: dir,
        HOME: '/Users/op',
        PATH: '/bin',
        TMPDIR: '/t',
        CAMOUFOX_WORKER_KEY: 'synthetic-worker-key-0123456789abcdef',
      },
    ]);
    expect(env).toEqual({
      CAMOUFOX_DATA_DIR: dir,
      HOME: '/Users/op',
      PATH: '/bin',
      TMPDIR: '/t',
      FOO: 'shell',
    });
  });
  it('a pre-set CAMOUFOX_WORKER_KEY that differs from the file refuses with 78, naming it and never a value', async () => {
    const dir = dataDir();
    const t = deps({ CAMOUFOX_DATA_DIR: dir, CAMOUFOX_WORKER_KEY: 'shell-key-0123456789abcdef0123456789' });
    expect(await run(['status'], t.d)).toBe(EX_CONFIG);
    expect(t.errs.join('\n')).toMatch(
      /CAMOUFOX_WORKER_KEY is set in the environment and differs from .*worker\.env/,
    );
    expect(t.errs.join('\n')).not.toContain('shell-key');
    expect(t.errs.join('\n')).not.toContain('synthetic-worker-key');
    expect(t.ran).toEqual([]);
  });
  it('an inherited CAMOUFOX_* or POINT_OF_SALE the file lacks refuses; one equal to the file passes', async () => {
    const dir = dataDir();
    for (const extra of [{ CAMOUFOX_INSTALL_DIR: '' }, { POINT_OF_SALE: 'US' }, { CAMOUFOX_DEBUG: '1' }]) {
      const t = deps({ CAMOUFOX_DATA_DIR: dir, ...extra });
      expect(await run(['status'], t.d), JSON.stringify(extra)).toBe(EX_CONFIG);
    }
    const ok = deps({ CAMOUFOX_DATA_DIR: dir, CAMOUFOX_WORKER_KEY: 'synthetic-worker-key-0123456789abcdef' });
    expect(await run(['status'], ok.d)).toBe(0);
  });
  it('DEBUG or PWDEBUG in the environment refuses (playwright-core would log protocol traffic, the SOCS value)', async () => {
    const dir = dataDir();
    for (const extra of [{ DEBUG: 'pw:protocol' }, { PWDEBUG: '1' }]) {
      const t = deps({ CAMOUFOX_DATA_DIR: dir, ...extra });
      expect(await run(['status'], t.d), JSON.stringify(extra)).toBe(EX_CONFIG);
      expect(t.errs.join()).toMatch(/DEBUG/);
    }
  });
  it('a 0644 file refuses with exit 78', async () => {
    const t = deps({ CAMOUFOX_DATA_DIR: dataDir({ fileMode: 0o644 }) });
    expect(await run(['status'], t.d)).toBe(EX_CONFIG);
    expect(t.errs.join()).toMatch(/0600/);
    expect(t.loaded).toEqual([]);
  });
  it('a 0755 directory refuses', async () => {
    const t = deps({ CAMOUFOX_DATA_DIR: dataDir({ dirMode: 0o755 }) });
    expect(await run(['status'], t.d)).toBe(EX_CONFIG);
    expect(t.errs.join()).toMatch(/0700/);
  });
  it.skipIf(asRoot)(`a file owned by another user refuses${asRoot ? ' (skipped as root)' : ''}`, () => {
    const dir = dataDir();
    const real = (p: string) => {
      const { statSync } = process.getBuiltinModule('node:fs');
      const s = statSync(p);
      return {
        mode: s.mode,
        uid: p.endsWith('worker.env') ? uid + 1 : s.uid,
        isDirectory: () => s.isDirectory(),
        isFile: () => s.isFile(),
      };
    };
    expect(() => checkEnvFiles(dir, uid, real)).toThrow(/not owned by this user/);
  });
  it('a directory owned by another user refuses', () => {
    expect(() => checkEnvFiles(dataDir(), uid + 1)).toThrow(/not owned by this user/);
  });
  it('a missing directory, a file in its place and a directory named worker.env refuse', () => {
    const base = tmpDir();
    expect(() => checkEnvFiles(join(base, 'nope'), uid)).toThrow(/mkdir -p -m 700/);
    writeFileSync(join(base, 'file'), '');
    expect(() => checkEnvFiles(join(base, 'file'), uid)).toThrow(/not a directory/);
    const d = dataDir({ fileMode: null });
    mkdirSync(join(d, 'worker.env'));
    expect(() => checkEnvFiles(d, uid)).toThrow(/not a file/);
  });
  it('a missing worker.env refuses every command but capture-socs', async () => {
    const dir = dataDir({ fileMode: null });
    const t = deps({ CAMOUFOX_DATA_DIR: dir });
    expect(await run(['status'], t.d)).toBe(EX_CONFIG);
    expect(await run(['capture-socs'], t.d)).toBe(0);
    expect(t.loaded).toEqual([]);
  });
  it('an unknown command refuses', async () => {
    const t = deps({ CAMOUFOX_DATA_DIR: dataDir() });
    expect(await run(['launch-rockets'], t.d)).toBe(EX_CONFIG);
    expect(await run([], t.d)).toBe(EX_CONFIG);
  });
  it('the data directory defaults under HOME and refuses a relative override', () => {
    expect(resolveDataDir({ HOME: '/Users/op' })).toBe('/Users/op/.local/state/get-me-there/camoufox');
    expect(() => resolveDataDir({ CAMOUFOX_DATA_DIR: 'data/camoufox' })).toThrow(/absolute/);
    expect(() => resolveDataDir({})).toThrow(/HOME/);
  });
  it('main runs a command against the live process and maps a thrown entry to exit 70', async () => {
    const errSpy: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array) => {
      errSpy.push(String(chunk));
      return true;
    };
    try {
      expect(await main(['no-such-command'])).toBe(EX_CONFIG);
      // why: main's one write (decision 73); this test runs it in the test process, so it takes it back each time
      delete process.env.CAMOUFOX_INSTALL_DIR;
      const dir = dataDir();
      const before = process.env.CAMOUFOX_DATA_DIR;
      process.env.CAMOUFOX_DATA_DIR = dir;
      try {
        expect(
          await main(['boom'], {
            boom: async () => async () => {
              throw new Error('entry failed');
            },
          }),
        ).toBe(EX_SOFTWARE);
      } finally {
        if (before === undefined) delete process.env.CAMOUFOX_DATA_DIR;
        else process.env.CAMOUFOX_DATA_DIR = before;
        delete process.env.CAMOUFOX_WORKER_KEY;
        delete process.env.CAMOUFOX_INSTALL_DIR;
      }
    } finally {
      process.stderr.write = write;
    }
    expect(errSpy.join('')).toMatch(/unknown command[\s\S]*entry failed/);
  });

  // why: decision 73: camoufox-js reads CAMOUFOX_INSTALL_DIR once, at import; the worker sets it and refuses any other
  it('an inherited CAMOUFOX_INSTALL_DIR is refused with 78, set or empty, before anything is read', async () => {
    const dir = dataDir();
    for (const value of ['/x', '']) {
      const t = deps({ CAMOUFOX_DATA_DIR: dir, CAMOUFOX_INSTALL_DIR: value }, { installDir: '/i' });
      expect(await run(['status'], t.d)).toBe(EX_CONFIG);
      expect(t.errs).toEqual([INSTALL_DIR_INHERITED]);
      expect(t.loaded).toEqual([]);
    }
    expect(() =>
      installDirSetting({ HOME: '/Users/op', CAMOUFOX_INSTALL_DIR: '/x' }, 'darwin', 'arm64'),
    ).toThrow(INSTALL_DIR_INHERITED);
  });
  it('the install directory is the root on macOS and the pinned bundle on Linux; none on Windows or without HOME', () => {
    expect(installDirSetting({ HOME: '/Users/op' }, 'darwin', 'arm64')).toBe(
      '/Users/op/.local/share/get-me-there/camoufox',
    );
    expect(installDirSetting({ HOME: '/home/op' }, 'linux', 'x64')).toBe(
      '/home/op/.local/share/get-me-there/camoufox/browsers/official/152.0.4-beta.28-924f3109',
    );
    expect(installDirSetting({ HOME: '/h' }, 'win32', 'x64')).toBeNull();
    expect(installDirSetting({}, 'darwin', 'arm64')).toBeNull();
    expect(installDirSetting({ HOME: 'relative' }, 'darwin', 'arm64')).toBeNull();
  });
  it('the entry’s environment carries the install directory main set; worker.env may not name one', async () => {
    const dir = dataDir();
    const t = deps(
      { CAMOUFOX_DATA_DIR: dir },
      { installDir: '/Users/op/.local/share/get-me-there/camoufox' },
    );
    expect(await run(['status'], t.d)).toBe(0);
    expect(t.envs[0]?.CAMOUFOX_INSTALL_DIR).toBe('/Users/op/.local/share/get-me-there/camoufox');
    const none = deps({ CAMOUFOX_DATA_DIR: dir }, { installDir: null });
    expect(await run(['status'], none.d)).toBe(0);
    expect(none.envs[0]).not.toHaveProperty('CAMOUFOX_INSTALL_DIR');
    writeFileSync(
      join(dir, 'worker.env'),
      'CAMOUFOX_WORKER_KEY=synthetic-worker-key-0123456789abcdef\nCAMOUFOX_INSTALL_DIR=/x\n',
    );
    const filed = deps({ CAMOUFOX_DATA_DIR: dir }, { installDir: '/i' });
    expect(await run(['status'], filed.d)).toBe(EX_CONFIG);
    expect(filed.errs.join()).toBe(
      `remove CAMOUFOX_INSTALL_DIR from ${dir}/worker.env (pnpm gmt browser install removes it): the worker sets it itself`,
    );
  });
  it('main sets CAMOUFOX_INSTALL_DIR in its own process once, after refusing an inherited one', async () => {
    const before = { home: process.env.HOME, set: process.env.CAMOUFOX_INSTALL_DIR };
    const write = process.stderr.write.bind(process.stderr);
    const errs: string[] = [];
    process.stderr.write = (chunk: string | Uint8Array) => {
      errs.push(String(chunk));
      return true;
    };
    try {
      delete process.env.CAMOUFOX_INSTALL_DIR;
      process.env.HOME = '/Users/op';
      expect(await main(['no-such-command'])).toBe(EX_CONFIG);
      expect(process.env.CAMOUFOX_INSTALL_DIR).toBe(
        installDirSetting({ HOME: '/Users/op' }, process.platform, process.arch) ?? undefined,
      );
      process.env.CAMOUFOX_INSTALL_DIR = '/elsewhere';
      // why: run() refuses the inherited value itself (after naming an unknown command first)
      expect(await main(['status'])).toBe(EX_CONFIG);
      expect(errs.at(-1)).toBe(`${INSTALL_DIR_INHERITED}\n`);
      expect(process.env.CAMOUFOX_INSTALL_DIR).toBe('/elsewhere');
    } finally {
      process.stderr.write = write;
      process.env.HOME = before.home;
      if (before.set === undefined) delete process.env.CAMOUFOX_INSTALL_DIR;
      else process.env.CAMOUFOX_INSTALL_DIR = before.set;
    }
  });
  // why: decision 74: the consent entry alone receives the display variables, by group, never DBUS_SESSION_BUS_ADDRESS
  it('the display variables reach the consent entry only, in their groups; main and every other entry never see them', async () => {
    const dir = dataDir();
    const inherited = {
      CAMOUFOX_DATA_DIR: dir,
      DISPLAY: ':0',
      XAUTHORITY: '/home/op/.Xauthority',
      WAYLAND_DISPLAY: 'wayland-0',
      XDG_RUNTIME_DIR: '/run/user/1000',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
    };
    const envs: Array<Record<string, string | undefined>> = [];
    const entry: Entry = async (ctx) => {
      envs.push({ ...ctx.env });
      return 0;
    };
    const t = deps(inherited, {
      entries: {
        consent: async () => entry,
        main: async () => entry,
        status: async () => entry,
        record: async () => entry,
      },
    });
    for (const c of [
      ['consent'],
      ['main'],
      ['status'],
      ['record', '--consent-research'],
      ['record', '--from', 'LHR'],
    ])
      expect(await run(c, t.d)).toBe(0);
    const shown = (e: Record<string, string | undefined> | undefined) =>
      Object.keys(e ?? {})
        .filter((k) => /DISPLAY|XAUTH|XDG_RUNTIME|DBUS/.test(k))
        .sort();
    // why: sec-b1-006: the research recorder opens a window a person uses, so it gets the same groups as consent
    const all = ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR'];
    expect(envs.map(shown)).toEqual([all, [], [], all, []]);
    const x11 = deps(
      { CAMOUFOX_DATA_DIR: dir, XAUTHORITY: '/a', XDG_RUNTIME_DIR: '/r', DISPLAY: ':1' },
      {
        entries: { consent: async () => entry },
      },
    );
    await run(['consent'], x11.d);
    expect(shown(envs.at(-1))).toEqual(['DISPLAY', 'XAUTHORITY']);
    const wayland = deps(
      { CAMOUFOX_DATA_DIR: dir, WAYLAND_DISPLAY: 'w', XDG_RUNTIME_DIR: '/r', XAUTHORITY: '/a' },
      {
        entries: { consent: async () => entry },
      },
    );
    await run(['consent'], wayland.d);
    expect(shown(envs.at(-1))).toEqual(['WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']);
  });
});

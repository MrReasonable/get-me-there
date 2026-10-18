import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkEnvFiles, type Entry, EX_CONFIG, EX_SOFTWARE, main, resolveDataDir, run } from '../src/run.js';
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
  const entry: Entry = async (ctx) => {
    ran.push(ctx.args);
    return 0;
  };
  return {
    loaded,
    errs,
    ran,
    d: {
      env,
      uid,
      loadEnvFile: (p: string) => {
        loaded.push(p);
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

describe('run.ts (SEC-R2-006: one env file, its mode checked on the file loaded)', () => {
  it('loads the checked path and dispatches', async () => {
    const dir = dataDir();
    const t = deps({ CAMOUFOX_DATA_DIR: dir });
    expect(await run(['status', '--x'], t.d)).toBe(0);
    expect(t.loaded).toEqual([join(dir, 'worker.env')]);
    expect(t.ran).toEqual([['--x']]);
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
      }
    } finally {
      process.stderr.write = write;
    }
    expect(errSpy.join('')).toMatch(/unknown command[\s\S]*entry failed/);
  });
});

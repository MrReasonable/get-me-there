// The build's version for the Status report (brief WP18 §5): a short SHA from dist/version.json, else "unknown".
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readVersion } from '../../src/bootstrap/version.js';
import { tempDir } from '../helpers/tmp.js';

const SCRIPT = fileURLToPath(new URL('../../scripts/write-version.mjs', import.meta.url));

describe('readVersion', () => {
  const file = (text: string) => {
    const p = join(tempDir('gmt-version-'), 'version.json');
    writeFileSync(p, text);
    return p;
  };
  it('reads a short SHA', () => {
    expect(readVersion(file('{"version":"abc1234"}'))).toBe('abc1234');
  });
  it('a missing, unreadable, malformed or unexpected file is "unknown", whatever it says', () => {
    expect(readVersion(join(tempDir('gmt-version-'), 'none.json'))).toBe('unknown');
    expect(readVersion(file('not json'))).toBe('unknown');
    expect(readVersion(file('{"version":"v1; rm -rf ~"}'))).toBe('unknown');
    expect(readVersion(file('{"version":"abc1234","extra":1}'))).toBe('unknown');
    expect(readVersion(tempDir('gmt-version-'))).toBe('unknown');
  });
  it('the source tree has no version file, so a tsx run reads "unknown"', () => {
    expect(readVersion()).toBe('unknown');
  });
});

// why: each case starts a Node process, and one a git process; a spawn is bounded at 30 s, so the case is given 60 s
describe('scripts/write-version.mjs (V0, ts-b1-011)', { timeout: 60_000 }, () => {
  /** Runs the script in `cwd` (a directory that is not a checkout unless the test makes it one), with only `env`. */
  function run(env: Record<string, string>, cwd: string, out: string) {
    return spawnSync(process.execPath, [SCRIPT, out], { encoding: 'utf8', timeout: 30_000, cwd, env });
  }
  const outFile = () => join(tempDir('gmt-version-'), 'out', 'version.json');

  it('writes the version the build was given, which readVersion reads, whether or not git is there', () => {
    const out = outFile();
    expect(run({ APP_VERSION: 'abc1234', PATH: '' }, tempDir('gmt-empty-'), out).status).toBe(0);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({ version: 'abc1234' });
    expect(readVersion(out)).toBe('abc1234');
  });

  it('with no version given and no git checkout it writes nothing and removes a stale file, so the app reads "unknown"', () => {
    const out = outFile();
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, '{"version":"deadbee"}\n');
    const r = run(
      { PATH: process.env.PATH ?? '', GIT_CEILING_DIRECTORIES: tmpdir() },
      tempDir('gmt-empty-'),
      out,
    );
    expect(r.status).toBe(0);
    expect(existsSync(out)).toBe(false);
    expect(readVersion(out)).toBe('unknown');
  });

  it('with git missing altogether it still ends cleanly with no file', () => {
    const out = outFile();
    expect(run({ PATH: '' }, tempDir('gmt-empty-'), out).status).toBe(0);
    expect(existsSync(out)).toBe(false);
  });

  it('a version that is not a short SHA is ignored', () => {
    const out = outFile();
    expect(run({ APP_VERSION: 'v1; rm -rf ~', PATH: '' }, tempDir('gmt-empty-'), out).status).toBe(0);
    expect(existsSync(out)).toBe(false);
  });

  it.skipIf(spawnSync('git', ['--version']).status !== 0)(
    'reads the checkout’s short SHA from a repository the test makes itself (needs the git program, not a checkout)',
    () => {
      const repo = tempDir('gmt-repo-');
      const git = (...args: string[]) =>
        spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
          cwd: repo,
          encoding: 'utf8',
        });
      expect(git('init', '-q').status).toBe(0);
      expect(git('commit', '--allow-empty', '-q', '-m', 'x').status).toBe(0);
      const want = git('rev-parse', '--short=7', 'HEAD').stdout.trim();
      const out = outFile();
      expect(run({ PATH: process.env.PATH ?? '' }, repo, out).status).toBe(0);
      expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({ version: want });
    },
  );
});

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Runner } from '../../src/exec/runner.js';
import { systemRunner } from '../../src/exec/runner.js';
import { systemExecutor } from '../../src/exec/system.js';
import { runAction } from '../../src/plan/action.js';
import { guarded, killTracked } from '../support/children.js';
import { tempDir } from '../support/tempdirs.js';

// why: these tests start real children (node, tar, zip). Stryker's per-mutant command leaves this file out: a bailed
// test worker killed while a child is being started can leave that child stuck in the kernel (PR #11), and
// system.test.ts covers the same rules with stand-in runners. The normal suite runs it on every push.
afterEach(() => {
  expect(killTracked()).toEqual([]);
});
const tmp = () => tempDir('gmt-sysexec-');
const mode = (p: string) => statSync(p).mode & 0o777;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

describe.skipIf(process.platform === 'win32')(
  'systemExecutor with real children (POSIX)',
  { timeout: 30_000 },
  () => {
    it('run uses execFile with the argv, never a shell, passes the input on stdin only, and resolves stdout', async () => {
      const d = tmp();
      const calls: Array<{ argv: readonly string[]; stdin: string | undefined }> = [];
      const spy: Runner = (argv, opts) => {
        calls.push({ argv, stdin: opts.stdin });
        return systemRunner(argv, opts);
      };
      const e = systemExecutor(spy, { sleep: async () => {} });
      const out = await e.run(
        runAction(
          [
            process.execPath,
            '-e',
            guarded(
              'require("fs").writeFileSync("out", require("fs").readFileSync(0)); console.log(process.argv[1])',
            ),
            '$HOME;x',
          ],
          d,
          { stdin: { text: 'SECRET-on-stdin', secret: true } },
        ),
      );
      expect(out).toEqual({ stdout: '$HOME;x\n' });
      expect(readFileSync(join(d, 'out'), 'utf8')).toBe('SECRET-on-stdin');
      expect(calls[0]?.argv.join(' ')).not.toContain('SECRET');
      expect(calls[0]?.stdin).toBe('SECRET-on-stdin');
      expect(existsSync(join(d, 'x'))).toBe(false);
    });

    it('unpack checks the hash and the entries, unpacks a tar or a zip into a fresh 0700 directory and moves it into place, making the parent', async () => {
      const d = tmp();
      mkdirSync(join(d, 'src', 'inner'), { recursive: true });
      writeFileSync(join(d, 'src', 'inner', 'f.txt'), 'packed');
      const calls: Array<{ argv: readonly string[]; cwd: string }> = [];
      const spy: Runner = (argv, opts) => {
        calls.push({ argv, cwd: opts.cwd });
        return systemRunner(argv, opts);
      };
      const e = systemExecutor(spy);
      const tar = join(d, 'a.tar');
      await systemRunner(['tar', '-cf', tar, '-C', join(d, 'src'), 'inner'], { cwd: d, timeoutMs: 30_000 });
      await e.run({
        kind: 'unpack',
        archive: tar,
        sha256: sha(readFileSync(tar)),
        to: join(d, 'nested', 'deep', 'out'),
      });
      expect(readFileSync(join(d, 'nested', 'deep', 'out', 'inner', 'f.txt'), 'utf8')).toBe('packed');
      expect(mode(join(d, 'nested', 'deep', 'out'))).toBe(0o700);
      expect(readdirSync(join(d, 'nested', 'deep'))).toEqual(['out']);
      expect(calls.map((c) => c.argv.slice(0, 2))).toEqual([
        ['tar', '-tf'],
        ['tar', '-xf'],
      ]);
      const zip = join(d, 'b.zip');
      if (
        (await systemRunner(['zip', '-qr', zip, 'inner'], { cwd: join(d, 'src'), timeoutMs: 30_000 }))
          .code === 0
      ) {
        await e.run({ kind: 'unpack', archive: zip, sha256: sha(readFileSync(zip)), to: join(d, 'zout') });
        expect(readFileSync(join(d, 'zout', 'inner', 'f.txt'), 'utf8')).toBe('packed');
        expect(calls.slice(-2).map((c) => c.argv.slice(0, 2))).toEqual([
          ['unzip', '-Z1'],
          ['unzip', '-q'],
        ]);
      }
    });
  },
);

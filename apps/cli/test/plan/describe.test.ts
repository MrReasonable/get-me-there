import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Action, commandLine, runAction } from '../../src/plan/action.js';
import { describeAction, describePlan } from '../../src/plan/describe.js';

// why: secrets long enough and from an alphabet no fixed text of a plan holds, so a hit is the secret itself
const secretArb = fc.stringMatching(/^[A-Za-z0-9_-]{16,48}$/);
const secretSuffix = (s: string) => s.slice(4, 16);

describe('describePlan never shows a secret (brief WP16b §5, §10)', () => {
  it('a secret file shows as "<path> (0600, n lines, values hidden)", never its contents', () => {
    fc.assert(
      fc.property(secretArb, fc.integer({ min: 0, max: 5 }), (secret, extra) => {
        const contents = `NODE_ENV=production\nAPP_BASIC_AUTH_PASS=${secret}\n${'X=1\n'.repeat(extra)}`;
        const text = describePlan({
          command: 'setup',
          actions: [{ kind: 'writeFile', path: '/h/app.env', contents, mode: 0o600, secret: true }],
          notes: [],
        });
        expect(text).toContain(`/h/app.env (0600, ${2 + extra} lines, values hidden)`);
        expect(text).not.toContain(secret);
        expect(text).not.toContain(secretSuffix(secret));
        expect(text).not.toContain(Buffer.from(secret).toString('base64url'));
      }),
    );
  });

  it('a run never shows its standard input, secret or not', () => {
    fc.assert(
      fc.property(secretArb, fc.boolean(), (secret, isSecret) => {
        const a = runAction(['docker', 'compose', 'run', 'app'], '/repo', {
          stdin: { text: secret, secret: isSecret },
        });
        const text = describePlan({ command: 'x', actions: [a], notes: [] });
        expect(text).not.toContain(secret);
        expect(text).toContain(isSecret ? '(secret input on stdin)' : '(input on stdin)');
      }),
    );
  });

  it('describes every action kind in one line', () => {
    const all: Action[] = [
      { kind: 'mkdir', path: '/d', mode: 0o755 },
      { kind: 'writeFile', path: '/f', contents: '', mode: 0o644, secret: false },
      { kind: 'download', url: 'https://example.invalid/a.zip', to: '/a.zip', sha256: 'ab', bytes: 3 },
      { kind: 'unpack', archive: '/a.zip', sha256: 'ab', to: '/a' },
      { kind: 'rename', from: '/a', to: '/b' },
      { kind: 'copy', from: '/a', to: '/b', mode: 0o600 },
      { kind: 'remove', path: '/a', recursive: false },
      { kind: 'remove', path: '/a', recursive: true },
      runAction(['launchctl', 'bootstrap', 'gui/501', '/p l.plist'], '/'),
      { kind: 'waitHealthy', url: 'http://127.0.0.1:3000/api/health', timeoutSeconds: 240 },
      {
        kind: 'waitGone',
        argv: ['launchctl', 'print', 'x'],
        describe: 'launchctl print x',
        timeoutSeconds: 45,
      },
      {
        kind: 'waitState',
        argv: ['systemctl'],
        describe: 'systemctl --user show u',
        until: ['inactive', 'failed'],
        timeoutSeconds: 45,
      },
      { kind: 'waitUnlocked', path: '/d/worker.lock', holder: 'the worker', timeoutSeconds: 285 },
    ];
    expect(all.map(describeAction)).toEqual([
      'make directory /d (0755)',
      'write /f (0644, 0 lines)',
      'download https://example.invalid/a.zip to /a.zip (3 bytes, sha256 ab)',
      'unpack /a.zip into /a (sha256 ab)',
      'move /a to /b',
      'copy /a to /b (0600)',
      'remove /a',
      'remove /a and everything in it',
      "run launchctl bootstrap gui/501 '/p l.plist'",
      'wait up to 240 s for http://127.0.0.1:3000/api/health',
      'wait up to 45 s until launchctl print x fails',
      'wait up to 45 s until systemctl --user show u prints inactive or failed',
      'wait up to 285 s until the worker lets go of /d/worker.lock',
    ]);
    expect(describePlan({ command: 'c', actions: [], notes: ['n1'] })).toBe('c: nothing to do\n  note: n1\n');
    expect(describePlan({ command: 'c', actions: all.slice(0, 1), notes: [] })).toBe(
      'c:\n  1. make directory /d (0755)\n',
    );
  });

  it('commandLine quotes words a shell would split or expand, and nothing else', () => {
    expect(commandLine(['a', 'b c', "it's", '$HOME', '--x=1', 'gui/501/local.get-me-there.app'])).toBe(
      `a 'b c' 'it'\\''s' '$HOME' --x=1 gui/501/local.get-me-there.app`,
    );
  });
});

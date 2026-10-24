import { describe, expect, it } from 'vitest';
import { lingerPlan, runLinger } from '../../src/setup/linger.js';
import { scriptedAsk, testWorld } from '../support/deps.js';

describe('linger (spec §13: gmt never runs sudo)', () => {
  it('linger: enable on Linux plans loginctl enable-linger <user> without sudo, unless it is on already', async () => {
    const w = testWorld({
      os: 'linux',
      run: (a) => (a[0] === 'loginctl' && a[1] === 'show-user' ? { code: 0, stdout: 'no\n' } : undefined),
    });
    const plan = await lingerPlan('enable', w.deps);
    expect(plan.map((a) => (a.kind === 'run' ? a.argv : a.kind))).toEqual([
      ['loginctl', 'enable-linger', 'op'],
    ]);
    expect(w.runner.calls[0]?.argv).toEqual(['loginctl', 'show-user', 'op', '--property=Linger', '--value']);
    const on = testWorld({
      os: 'linux',
      run: (a) => (a[1] === 'show-user' ? { code: 0, stdout: 'yes\n' } : undefined),
    });
    expect(await lingerPlan('enable', on.deps)).toEqual([]);
    expect(await lingerPlan('skip', w.deps)).toEqual([]);
    expect(await lingerPlan('enable', testWorld({ os: 'darwin' }).deps)).toEqual([]);
  });

  it('a refusal prints the exact sudo line and setup carries on; nothing prompts', async () => {
    const ask = scriptedAsk([]);
    const w = testWorld({
      os: 'linux',
      ask,
      run: (a) =>
        a[0] === 'loginctl'
          ? a[1] === 'show-user'
            ? { code: 0, stdout: 'no\n' }
            : { code: 1, stderr: 'Access denied' }
          : undefined,
    });
    const r = await runLinger('enable', w.deps);
    expect(r).toBe('refused');
    expect(w.io.stdout).toContain('sudo loginctl enable-linger op\n');
    expect(w.runner.calls.some((c) => c.argv[0] === 'sudo')).toBe(false);
    expect(ask.asked).toEqual([]);
  });

  it('an accepted request reports enabled', async () => {
    const w = testWorld({
      os: 'linux',
      run: (a) => (a[1] === 'show-user' ? { code: 0, stdout: 'no\n' } : undefined),
    });
    expect(await runLinger('enable', w.deps)).toBe('enabled');
    expect(await runLinger('skip', w.deps)).toBe('unchanged');
  });
});

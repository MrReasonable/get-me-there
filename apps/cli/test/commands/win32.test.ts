import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { WIN32_REFUSAL } from '../../src/platform/win32.js';
import { testWorld } from '../support/deps.js';

describe('setup on win32 (decision 78)', () => {
  it('setup --dry-run prints the refusal and exits 0 with no plan', async () => {
    const w = testWorld({ os: 'win32' });
    expect(await runCli(['setup', '--dry-run'], w.deps)).toBe(0);
    expect(w.io.stdout).toBe(`${WIN32_REFUSAL}\n`);
    expect(w.executor.log).toEqual([]);
    expect(w.runner.calls).toEqual([]);
  });
  it('setup exits 78 with the same text and does nothing', async () => {
    const w = testWorld({ os: 'win32' });
    expect(await runCli(['setup'], w.deps)).toBe(78);
    expect(w.io.stdout).toBe(`${WIN32_REFUSAL}\n`);
    expect(w.executor.log).toEqual([]);
  });
  it('runCli prints help with 0 and a usage error with 64', async () => {
    const w = testWorld();
    expect(await runCli(['--help'], w.deps)).toBe(0);
    expect(w.io.stdout).toContain('usage: pnpm gmt');
    expect(await runCli(['nope'], w.deps)).toBe(64);
    expect(w.io.stderr).toContain('unknown command: nope');
  });
});

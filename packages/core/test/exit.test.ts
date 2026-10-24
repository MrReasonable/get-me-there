import { describe, expect, it } from 'vitest';
import { EXIT } from '../src/index.js';

// why: U9 (ca-b1-013): one exit-code table for every command line (the app, the tools, the scripts and gmt)
describe('EXIT, the one exit-code table', () => {
  it('holds each code once, with the sysexits meanings', () => {
    expect(EXIT).toEqual({
      ok: 0,
      failed: 1,
      smokeNoProviders: 2,
      smokeEmpty: 3,
      usage: 64,
      spendRefused: 65,
      refusedTestEnv: 70,
      preflightImpossible: 73,
      backupFailed: 74,
      lockRefused: 75,
      badConfig: 78,
    });
    expect(new Set(Object.values(EXIT)).size).toBe(Object.values(EXIT).length);
  });
});

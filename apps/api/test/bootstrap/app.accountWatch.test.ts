// Settings plan ruling 10: the app tells SearchApi's balance cache of each run's end through the engine's run watch, and
// a failure of that cache never reaches the run registry's settle. The engine and the cache are wrapped to capture them.
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import type { RunWatch } from '@gmt/engine';
import { describe, expect, it, vi } from 'vitest';
import { bootApp } from '../../src/bootstrap/app.js';
import { assetPaths } from '../../src/bootstrap/paths.js';
import { createLogger } from '../../src/logger.js';
import { cleanEnv } from '../helpers/env.js';
import { bootEnv, captureLines } from '../helpers/harness.js';
import { tempDir } from '../helpers/tmp.js';

const seen = vi.hoisted(() => {
  const state: { watch: RunWatch | null; runEnded: number[]; throwing: boolean; closed: number } = {
    watch: null,
    runEnded: [],
    throwing: false,
    closed: 0,
  };
  return state;
});
vi.mock('../../src/bootstrap/engine.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/bootstrap/engine.js')>();
  return {
    ...orig,
    engineFor: (...args: Parameters<typeof orig.engineFor>) => {
      seen.watch = args[2]?.runWatch ?? null;
      return orig.engineFor(...args);
    },
  };
});
vi.mock('../../src/read/searchApiAccount.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/read/searchApiAccount.js')>();
  return {
    ...orig,
    searchApiAccountFor: (...args: Parameters<typeof orig.searchApiAccountFor>) => {
      const port = orig.searchApiAccountFor(...args);
      return {
        ...port,
        runEnded: () => {
          seen.runEnded.push(seen.runEnded.length);
          if (seen.throwing) throw new Error('cache check broke');
        },
        close: () => {
          seen.closed += 1;
          port.close();
        },
      };
    },
  };
});

const T0 = asIsoDateTime('2026-11-19T12:00:00.000Z');
const TIMEOUT_MS = 60_000;

describe('bootApp: SearchApi’s balance cache and the engine’s run watch', () => {
  it(
    'tells the cache of each run’s end, logs and swallows its failure, and closes it with the app',
    async () => {
      const env = cleanEnv({
        NODE_ENV: 'development',
        DATABASE_PATH: join(tempDir('gmt-account-watch-'), 'a.db'),
        BIND_ADDRESS: '127.0.0.1',
        LOG_LEVEL: 'info',
      });
      const lines: string[] = [];
      const log = createLogger(bootEnv(env).config, { destination: captureLines(lines), secrets: [] });
      const running = await bootApp({
        ...bootEnv(env),
        clock: fixedClock(T0),
        log,
        listen: false,
        assets: assetPaths(),
      });
      const watch = seen.watch;
      if (watch === null) throw new Error('the engine was given no run watch');
      watch.ended();
      expect(seen.runEnded).toHaveLength(1);
      seen.throwing = true;
      expect(() => watch.ended()).not.toThrow();
      expect(seen.runEnded).toHaveLength(2);
      expect(lines.join('')).toContain('the SearchApi balance cache check failed');
      await running.close();
      expect(seen.closed).toBe(1);
    },
    TIMEOUT_MS,
  );
});

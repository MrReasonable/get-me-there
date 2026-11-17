import { parseConfig } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { targetFrom } from '../src/appClient.js';

// why: the CLI must aim at the port the app listens on, so it reads PORT by the app's own rule (core's parseConfig:
// Number coercion, an integer from 1 to 65535, empty = unset), else the default
describe('targetFrom reads PORT as the app does', () => {
  const appPort = (port: string) => {
    const r = parseConfig(
      { NODE_ENV: 'production', DATABASE_PATH: '/d/x.db', BIND_ADDRESS: '127.0.0.1', PORT: port },
      { realpath: (p) => p },
    );
    return r.ok ? r.config.port : null;
  };
  it.each([
    ['3917', 3917],
    ['3917.0', 3917],
    [' 3917 ', 3917],
    ['1', 1],
    ['65535', 65535],
    ['65536', 3000],
    ['0', 3000],
    ['-1', 3000],
    ['3917.5', 3000],
    ['abc', 3000],
    ['', 3000],
  ])('PORT=%j targets %i', (port, want) => {
    expect(targetFrom({ PORT: port }).port).toBe(want);
    // why: where the app accepts the value it listens on the same port; where it refuses it, the CLI's default stands
    const app = appPort(port);
    if (app !== null) expect(want).toBe(app);
    else expect(want).toBe(3000);
  });
  it('no PORT line is the default given', () => {
    expect(targetFrom({}, 4000).port).toBe(4000);
    expect(targetFrom({ PORT: '99999' }, 4000).port).toBe(4000);
  });
});

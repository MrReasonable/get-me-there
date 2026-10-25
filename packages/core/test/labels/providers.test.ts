import { describe, expect, it } from 'vitest';
import { START_REFUSAL_FILE } from '../../src/camoufox/start.js';
import { isLoopbackHost } from '../../src/config/schema.js';
import { PROVIDER_NAMES } from '../../src/labels/providers.js';

describe('shared names', () => {
  it('every provider has one short name', () => {
    expect(PROVIDER_NAMES).toEqual({
      travelpayouts: 'Travelpayouts',
      searchapi: 'SearchApi',
      camoufox: 'Camoufox',
      fixture: 'Fixture',
    });
  });
  it('the refusal file name is one constant', () => {
    expect(START_REFUSAL_FILE).toBe('start-refusal.json');
  });
  it.each([
    ['127.0.0.1', true],
    ['127.3.4.5', true],
    ['::1', true],
    ['localhost', true],
    ['0.0.0.0', false],
    ['192.168.1.4', false],
    ['localhost.example', false],
  ])('isLoopbackHost(%s) is %s', (host, want) => {
    expect(isLoopbackHost(host)).toBe(want);
  });
});

import { describe, expect, it } from 'vitest';
import { assertMacOS } from '../src/platform.js';

describe('platform (decision 69 round 2: macOS only)', () => {
  it('darwin passes', () => {
    expect(() => assertMacOS('darwin')).not.toThrow();
  });
  it.each(['linux', 'win32'])('%s refuses', (p) => {
    expect(() => assertMacOS(p)).toThrow('the camoufox worker supports macOS only');
  });
});

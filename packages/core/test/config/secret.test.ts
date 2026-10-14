import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { Secret } from '../../src/config/secret.js';

describe('Secret', () => {
  const s = new Secret('hunter2hunter2');
  it('reveals on request only', () => expect(s.reveal()).toBe('hunter2hunter2'));
  it('prints redacted everywhere a value could leak', () => {
    expect(String(s)).toBe('[redacted]');
    expect(`${s}`).toBe('[redacted]');
    expect(JSON.stringify({ s })).toBe('{"s":"[redacted]"}');
    expect(inspect(s)).toBe('[redacted]');
    expect(Object.keys(s)).toEqual([]); // the value is not an enumerable property
  });
});

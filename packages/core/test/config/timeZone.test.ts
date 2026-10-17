import { describe, expect, it } from 'vitest';
import { isValidTimeZone } from '../../src/config/schema.js';
import * as core from '../../src/index.js';

describe('isValidTimeZone, the one zone check (SCHEDULER_TIMEZONE, schedule tz, airport tz; code-architect review 6)', () => {
  it('accepts an IANA zone the runtime knows and refuses one it does not', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(core.isValidTimeZone).toBe(isValidTimeZone);
  });
});

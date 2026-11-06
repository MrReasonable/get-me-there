import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDate, asIsoDateTime, fixedClock, type IsoDateTime } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppInstances, INSTANCES_FILE } from '../src/instances.js';
import { tmpDir } from './support/tmp.js';

const at = (s: string): IsoDateTime => asIsoDateTime(s);

beforeEach(() => {
  expect.hasAssertions();
});

describe('app instances (decision 82: a second one is reported, never refused)', () => {
  it('counts each id once a calendar month, kept only as a digest; a malformed id is ignored', () => {
    const d = tmpDir();
    let now = at('2027-03-10T12:00:00.000Z');
    const i = new AppInstances({
      dir: d,
      clock: { now: () => now, todayLondon: () => asIsoDate('2027-03-10') },
    });
    expect(INSTANCES_FILE).toBe('app-instances.json');
    expect(i.status()).toEqual({ windowStart: '2027-03-01T00:00:00.000Z', count: 0 });
    i.seen('a'.repeat(64));
    i.seen('a'.repeat(64));
    i.seen('bad id with spaces');
    expect(i.status().count).toBe(1);
    i.seen('instance-two');
    expect(i.status().count).toBe(2);
    const text = readFileSync(join(d, 'app-instances.json'), 'utf8');
    expect(text).not.toContain('instance-two');
    // why: the month turns at 00:00 UTC on the 1st, never the London month
    now = at('2027-03-31T23:59:59.999Z');
    expect(i.status()).toEqual({ windowStart: '2027-03-01T00:00:00.000Z', count: 2 });
    now = at('2027-04-01T00:00:00.000Z');
    expect(i.status()).toEqual({ windowStart: '2027-04-01T00:00:00.000Z', count: 0 });
    writeFileSync(join(d, 'app-instances.json'), '{');
    expect(i.status().count).toBe(0);
  });

  it('an instances file of another shape starts the month’s list afresh; the file is 0600', () => {
    const d = tmpDir();
    const i = new AppInstances({ dir: d, clock: fixedClock(at('2027-03-10T12:00:00.000Z')) });
    for (const text of [
      'null',
      '{"windowStart":"2027-03-01T00:00:00.000Z"}',
      '{"windowStart":"2027-03-01T00:00:00.000Z","ids":"x"}',
      `{"windowStart":"2027-03-01T00:00:00.000Z","ids":["${'a'.repeat(63)}"]}`,
      `{"windowStart":"2027-03-01T00:00:00.000Z","ids":["x${'a'.repeat(64)}"]}`,
      `{"windowStart":"2027-03-01T00:00:00.000Z","ids":[7]}`,
      // why: ts-b1-001: one malformed entry beside a valid digest, and a 65-character digest, start afresh too
      `{"windowStart":"2027-03-01T00:00:00.000Z","ids":["${'c'.repeat(64)}",7]}`,
      `{"windowStart":"2027-03-01T00:00:00.000Z","ids":["${'c'.repeat(64)}","x${'c'.repeat(64)}"]}`,
      `{"windowStart":"2027-03-01T00:00:00.000Z","ids":["${'c'.repeat(65)}"]}`,
      `{"windowStart":"2027-03-01T00:00:00.000Z","ids":["${'c'.repeat(64)}",["${'d'.repeat(64)}"]]}`,
      // why: another month's list is not this month's
      `{"windowStart":"2027-02-01T00:00:00.000Z","ids":["${'c'.repeat(64)}"]}`,
    ]) {
      writeFileSync(join(d, 'app-instances.json'), text);
      expect(i.status().count, text).toBe(0);
    }
    writeFileSync(
      join(d, 'app-instances.json'),
      `{"windowStart":"2027-03-01T00:00:00.000Z","ids":["${'b'.repeat(64)}"]}`,
    );
    expect(i.status().count).toBe(1);
    i.seen('next-app');
    expect(statSync(join(d, 'app-instances.json')).mode & 0o777).toBe(0o600);
    expect(i.status().count).toBe(2);
  });
});

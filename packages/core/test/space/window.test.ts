import { describe, expect, it } from 'vitest';
import { countCells } from '../../src/space/generate.js';
import { resolveSpace, resolveWindow } from '../../src/space/window.js';
import type { WindowSpec } from '../../src/types/definition.js';
import { asIsoDate } from '../../src/types/ids.js';
import { iatas } from '../helpers/space.js';

const d = asIsoDate;

describe('resolveWindow (spec §6.1)', () => {
  it('resolves the default relative window (offset 7, length 182) from 2026-10-14', () => {
    expect(resolveWindow({ kind: 'relative', startOffsetDays: 7, lengthDays: 182 }, d('2026-10-14'))).toEqual(
      {
        departureFrom: '2026-10-21',
        departureTo: '2027-04-20',
        clamped: false,
      },
    );
  });

  it('resolves across a month end (2027-01-30 + 7 = 2027-02-06; +181 = 2027-08-06)', () => {
    expect(resolveWindow({ kind: 'relative', startOffsetDays: 7, lengthDays: 182 }, d('2027-01-30'))).toEqual(
      {
        departureFrom: '2027-02-06',
        departureTo: '2027-08-06',
        clamped: false,
      },
    );
  });

  it('startOffsetDays 1 starts tomorrow; lengthDays 1 is a single day', () => {
    expect(resolveWindow({ kind: 'relative', startOffsetDays: 1, lengthDays: 1 }, d('2028-02-28'))).toEqual({
      departureFrom: '2028-02-29',
      departureTo: '2028-02-29',
      clamped: false,
    });
  });

  it('leaves a future absolute window alone', () => {
    expect(
      resolveWindow({ kind: 'absolute', from: d('2027-03-01'), to: d('2027-03-31') }, d('2026-10-14')),
    ).toEqual({
      departureFrom: '2027-03-01',
      departureTo: '2027-03-31',
      clamped: false,
    });
  });

  it('accepts an absolute window starting exactly tomorrow without clamping', () => {
    expect(
      resolveWindow({ kind: 'absolute', from: d('2026-10-15'), to: d('2026-10-20') }, d('2026-10-14'))
        .clamped,
    ).toBe(false);
  });

  it('clamps an absolute window that starts today or earlier to tomorrow', () => {
    expect(
      resolveWindow({ kind: 'absolute', from: d('2026-10-01'), to: d('2026-10-31') }, d('2026-10-14')),
    ).toEqual({
      departureFrom: '2026-10-15',
      departureTo: '2026-10-31',
      clamped: true,
    });
    expect(
      resolveWindow({ kind: 'absolute', from: d('2026-10-14'), to: d('2026-10-31') }, d('2026-10-14'))
        .departureFrom,
    ).toBe('2026-10-15');
  });

  it('an absolute window wholly in the past resolves to zero cells', () => {
    const w = resolveWindow(
      { kind: 'absolute', from: d('2026-09-01'), to: d('2026-10-14') },
      d('2026-10-14'),
    );
    expect(w).toEqual({ departureFrom: '2026-10-15', departureTo: '2026-10-14', clamped: true });
    expect(
      countCells({ origins: iatas('LHR'), destinations: iatas('JFK'), minNights: 1, maxNights: 1, ...w }),
    ).toBe(0);
  });

  it.each([
    [{ kind: 'relative', startOffsetDays: 0, lengthDays: 10 }],
    [{ kind: 'relative', startOffsetDays: 1.5, lengthDays: 10 }],
    [{ kind: 'relative', startOffsetDays: 7, lengthDays: 0 }],
    [{ kind: 'relative', startOffsetDays: 7, lengthDays: 2.5 }],
  ] satisfies Array<[WindowSpec]>)('throws RangeError on %j (validation rejects these first)', (w) => {
    expect(() => resolveWindow(w, d('2026-10-14'))).toThrow(RangeError);
  });
});

describe('resolveSpace (spec §6.1: the one resolution rule the api, engine and validation share)', () => {
  const def = {
    origins: iatas('LHR', 'LGW'),
    destinations: iatas('JFK'),
    minNights: 10,
    maxNights: 21,
  };
  it('resolves the window against today and carries the airports and nights', () => {
    const r = resolveSpace(
      { ...def, window: { kind: 'relative', startOffsetDays: 7, lengthDays: 10 } },
      asIsoDate('2026-10-14'),
    );
    expect(r).toEqual({
      space: {
        origins: ['LHR', 'LGW'],
        destinations: ['JFK'],
        departureFrom: '2026-10-21',
        departureTo: '2026-10-30',
        minNights: 10,
        maxNights: 21,
      },
      clamped: false,
    });
  });
  it('reports a clamped absolute window, and copies the airport lists', () => {
    const input = {
      ...def,
      window: { kind: 'absolute' as const, from: asIsoDate('2026-10-01'), to: asIsoDate('2026-11-01') },
    };
    const r = resolveSpace(input, asIsoDate('2026-10-14'));
    expect([r.space.departureFrom, r.clamped]).toEqual(['2026-10-15', true]);
    expect(r.space.origins).not.toBe(input.origins);
  });
});

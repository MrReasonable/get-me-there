import { describe, expect, it } from 'vitest';
import {
  nullableOneOf,
  oneOf,
  RowCorrupt,
  readBaggage,
  readBool,
  readCellKey,
  readFareConditions,
  readInt,
  readJson,
  readLayovers,
  readNullableTime,
  readString,
  readStringArray,
  readVerificationPolicy,
} from '../src/internal/read.js';

// The row-mapping toolkit (ruling 15, dm-006): a stored value that does not parse is RowCorrupt naming the column,
// never passed through. Nested shapes parse through core's own schemas (arch-M1), so db and core cannot drift.
const corrupt = (fn: () => unknown, column = 'c') =>
  expect(fn).toThrow(expect.objectContaining({ name: 'RowCorrupt', column }));

describe('internal/read', () => {
  it('layovers parse through core: a negative minutes or a bad code is corrupt', () => {
    const ok = { at: 'JFK', minutes: 95, overnight: false, airportChange: false };
    expect(readLayovers('c', [ok])).toEqual([ok]);
    corrupt(() => readLayovers('c', [{ ...ok, minutes: -1 }]));
    corrupt(() => readLayovers('c', [{ ...ok, at: 'J1' }]));
    corrupt(() => readLayovers('c', { not: 'an array' }));
  });

  it('cell keys parse through core', () => {
    const ok = { origin: 'LHR', destination: 'JFK', departureDate: '2027-03-14', returnDate: '2027-03-28' };
    expect(readCellKey('c', ok)).toEqual(ok);
    corrupt(() => readCellKey('c', { ...ok, departureDate: '2027-02-30' }));
    corrupt(() => readCellKey('c', null));
  });

  it('baggage and fare conditions parse through core: a negative bag count or an unknown cabin-bag value is corrupt', () => {
    expect(readBaggage('c', { cabinBag: 'included', checkedBags: 1 })).toEqual({
      cabinBag: 'included',
      checkedBags: 1,
    });
    corrupt(() => readBaggage('c', { checkedBags: -1 }));
    corrupt(() => readBaggage('c', { cabinBag: 'maybe' }));
    expect(readFareConditions('c', { refundable: false, notes: ['x'] })).toEqual({
      refundable: false,
      notes: ['x'],
    });
    corrupt(() => readFareConditions('c', { changeable: 'yes' }));
  });

  it('scalars, enums, JSON and the verification policy name the corrupt column', () => {
    corrupt(() => readJson('c', '{'));
    corrupt(() => readInt('c', 1.5));
    corrupt(() => readBool('c', 1));
    corrupt(() => readString('c', 1));
    corrupt(() => readStringArray('c', ['a', 1]));
    corrupt(() => readNullableTime('c', '2026-10-14T12:00:00Z'));
    expect(readNullableTime('c', null)).toBeNull();
    corrupt(() => oneOf('c', ['a', 'b'], 'z'));
    expect(nullableOneOf('c', ['a'], null)).toBeNull();
    corrupt(() => readVerificationPolicy('c', { maxCells: 1 }));
    expect(new RowCorrupt('c', 'x').message).toBe('stored c is not valid: x');
  });
});

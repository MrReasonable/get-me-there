// The settings table's repository (settings plan rulings 2 and 4): rows are the Settings page's owned names, stored as
// `.env` stores them; a name the page does not own is refused on write, and a row with one is left out on read.
import { OWNED_NAMES } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { RowRejected } from '../src/internal/validate.js';
import { SettingsRepo } from '../src/repositories/settings.js';
import { at, count, freshDb, T0 } from './helpers/db.js';

beforeEach(() => {
  expect.hasAssertions();
});

describe('SettingsRepo', () => {
  it('starts empty', () => {
    expect(new SettingsRepo(freshDb()).all()).toEqual([]);
  });

  it('round-trips every owned name, a blank value included, in name order', () => {
    const db = freshDb();
    const repo = new SettingsRepo(db);
    const rows = OWNED_NAMES.map((name, i) => ({ name, value: i === 0 ? '' : `value ${name} ${i}` }));
    repo.write(rows, T0);
    expect(repo.all()).toEqual([...rows].sort((a, b) => a.name.localeCompare(b.name)));
    expect(db.raw.prepare('SELECT DISTINCT updated_at FROM settings').all()).toEqual([{ updated_at: T0 }]);
  });

  it('a later write replaces a value and its time, and leaves other rows alone', () => {
    const db = freshDb();
    const repo = new SettingsRepo(db);
    repo.write(
      [
        { name: 'SEARCHAPI_PLAN', value: 'trial' },
        { name: 'SMTP_PORT', value: '465' },
      ],
      T0,
    );
    const later = at('2026-11-19T08:00:00.000Z');
    repo.write([{ name: 'SEARCHAPI_PLAN', value: '40usd' }], later);
    expect(repo.all()).toEqual([
      { name: 'SEARCHAPI_PLAN', value: '40usd' },
      { name: 'SMTP_PORT', value: '465' },
    ]);
    expect(db.raw.prepare('SELECT name, updated_at FROM settings ORDER BY name').all()).toEqual([
      { name: 'SEARCHAPI_PLAN', updated_at: later },
      { name: 'SMTP_PORT', updated_at: T0 },
    ]);
  });

  it('refuses a name the page does not own and writes none of the batch', () => {
    const db = freshDb();
    const repo = new SettingsRepo(db);
    const rows = [
      { name: 'SEARCHAPI_PLAN', value: '40usd' },
      { name: 'SEARCHAPI_TRIAL_USED', value: '9' },
    ];
    // why: the batch arrives as data a caller built; the repository is the gate, whatever the type said
    const write = () => Reflect.apply(SettingsRepo.prototype.write, repo, [rows, T0]);
    expect(write).toThrow(RowRejected);
    expect(write).toThrow(/settings\.name/);
    expect(count(db, 'settings')).toBe(0);
  });

  it('leaves out a stored row whose name it does not know (a row a later version wrote), so boot never stops on it', () => {
    const db = freshDb();
    db.raw
      .prepare('INSERT INTO settings (name, value, updated_at) VALUES (?, ?, ?)')
      .run('SOME_LATER_SETTING', 'x', T0);
    new SettingsRepo(db).write([{ name: 'SMTP_TLS', value: 'starttls' }], T0);
    expect(new SettingsRepo(db).all()).toEqual([{ name: 'SMTP_TLS', value: 'starttls' }]);
  });
});

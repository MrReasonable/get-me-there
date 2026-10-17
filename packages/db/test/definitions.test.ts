import { fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { RowCorrupt } from '../src/internal/read.js';
import { RowRejected } from '../src/internal/validate.js';
import { DefinitionsRepo } from '../src/repositories/definitions.js';
import { count, freshDb, T0 } from './helpers/db.js';
import { exampleDefinitionInput, JFK } from './helpers/factories.js';

describe('DefinitionsRepo (spec §7 search_definitions)', () => {
  it('round-trips every field; confirmed cost starts null', () => {
    const repo = new DefinitionsRepo(freshDb(), fixedClock(T0));
    const input = exampleDefinitionInput({
      destinationNotes: { [JFK]: 'onward leg not included' },
      onwardCostPence: { [JFK]: 4500 },
    });
    const created = repo.create(input);
    expect(created).toEqual({
      ...input,
      id: created.id,
      confirmedCostPence: null,
      confirmedCalls: null,
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
    });
    expect(repo.get(created.id)).toEqual(created);
    expect(repo.get('missing')).toBeNull();
  });

  it("create stores the create click's confirmation in the same INSERT; a non-integer confirmation writes nothing (arch-r2-005, dm-r2-002)", () => {
    const db = freshDb();
    const repo = new DefinitionsRepo(db, fixedClock(T0));
    const created = repo.create({ ...exampleDefinitionInput(), confirmedCostPence: 1_250 });
    expect(created.confirmedCostPence).toBe(1_250);
    expect(repo.get(created.id)?.confirmedCostPence).toBe(1_250);
    expect(() => repo.create({ ...exampleDefinitionInput(), confirmedCostPence: 12.5 })).toThrow(
      expect.objectContaining({ rule: 'integer' }),
    );
    expect(repo.list()).toHaveLength(1);
  });

  it('update merges a patch and moves updated_at', () => {
    const clock = fixedClock(T0);
    const repo = new DefinitionsRepo(freshDb(), clock);
    const d = repo.create(exampleDefinitionInput());
    clock.advance(60_000);
    expect(repo.update(d.id, { maxNights: 14, enabled: false })).toMatchObject({
      maxNights: 14,
      enabled: false,
      minNights: 10,
      createdAt: T0,
      updatedAt: '2026-10-14T12:01:00.000Z',
    });
  });

  it('soft delete: hidden from list unless asked, kept for history, refuses updates, keeps executions', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const repo = new DefinitionsRepo(db, clock);
    const keep = repo.create(exampleDefinitionInput({ name: 'kept' }));
    const gone = repo.create(exampleDefinitionInput({ name: 'gone' }));
    db.raw
      .prepare(
        `INSERT INTO search_executions (id, definition_id, definition_snapshot_json, trigger, status, created_at) VALUES ('e1', ?, '{}', 'manual', 'completed', ?)`,
      )
      .run(gone.id, T0);
    clock.advance(1000);
    repo.softDelete(gone.id);
    expect(repo.list().map((d) => d.name)).toEqual(['kept']);
    expect(repo.list({ includeDeleted: true }).map((d) => d.name)).toEqual(['kept', 'gone']);
    expect(repo.get(gone.id)).toMatchObject({ deletedAt: '2026-10-14T12:00:01.000Z', enabled: false });
    expect(() => repo.update(gone.id, { name: 'x' })).toThrow(RowRejected);
    expect(() => repo.softDelete('missing')).toThrow(/missing/);
    expect(count(db, 'search_executions')).toBe(1);
    expect(repo.get(keep.id)?.deletedAt).toBeNull();
  });

  it('setConfirmed stores integer pence and calls together, and update never touches them (decision 37)', () => {
    const repo = new DefinitionsRepo(freshDb(), fixedClock(T0));
    const d = repo.create(exampleDefinitionInput());
    repo.setConfirmed(d.id, { pence: 412, calls: 30 });
    repo.update(d.id, { name: 'renamed' });
    expect(repo.get(d.id)).toMatchObject({ confirmedCostPence: 412, confirmedCalls: 30 });
    repo.setConfirmed(d.id, null);
    expect(repo.get(d.id)).toMatchObject({ confirmedCostPence: null, confirmedCalls: null });
    expect(() => repo.setConfirmed(d.id, { pence: 4.5, calls: 1 })).toThrow(RowRejected);
    expect(() => repo.setConfirmed(d.id, { pence: 1, calls: 1.5 })).toThrow(RowRejected);
    expect(() => repo.setConfirmed('missing', { pence: 1, calls: 1 })).toThrow(/missing/);
    expect(repo.get(d.id)).toMatchObject({ confirmedCostPence: null, confirmedCalls: null });
    const created = repo.create({ ...exampleDefinitionInput(), confirmedCostPence: 5, confirmedCalls: 7 });
    expect(repo.get(created.id)).toMatchObject({ confirmedCostPence: 5, confirmedCalls: 7 });
  });

  it('rejects non-integer nights, budgets and onward costs', () => {
    const repo = new DefinitionsRepo(freshDb(), fixedClock(T0));
    expect(() => repo.create(exampleDefinitionInput({ minNights: 10.5 }))).toThrow(/min_nights/);
    expect(() =>
      repo.create(exampleDefinitionInput({ budget: { maxCalls: 1, maxFreeCalls: 1, maxCostMicroGbp: 0.5 } })),
    ).toThrow(/maxCostMicroGbp/);
    expect(() => repo.create(exampleDefinitionInput({ onwardCostPence: { [JFK]: 12.3 } }))).toThrow(/onward/);
  });

  it('a corrupt stored JSON column is reported as RowCorrupt, never returned (dm-006)', () => {
    const db = freshDb();
    const repo = new DefinitionsRepo(db, fixedClock(T0));
    const d = repo.create(exampleDefinitionInput());
    db.raw.prepare(`UPDATE search_definitions SET window_json = '{"kind":"weekly"}' WHERE id = ?`).run(d.id);
    expect(() => repo.get(d.id)).toThrow(RowCorrupt);
  });
});

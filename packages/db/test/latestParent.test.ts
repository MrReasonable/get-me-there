// Spec revision 55 §10 (the cards): `latestParentPerDefinition` is the newest parent run of each definition, by
// created_at then rowid, children and tool runs left out, read in one statement.
import { asIata, asIsoDate, fixedClock } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { DefinitionsRepo } from '../src/repositories/definitions.js';
import { ExecutionsRepo } from '../src/repositories/executions.js';
import { freshDb, T0 } from './helpers/db.js';
import { exampleDefinitionInput, snapshotOf } from './helpers/factories.js';

beforeEach(() => {
  expect.hasAssertions();
});

describe('ExecutionsRepo.latestParentPerDefinition (revision 55 §10)', () => {
  it('returns the newest parent per definition, children and tool runs excluded, ties broken by insertion', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const defs = new DefinitionsRepo(db, clock);
    const repo = new ExecutionsRepo(db, clock);
    const a = defs.create(exampleDefinitionInput({ name: 'a' }));
    const b = defs.create(exampleDefinitionInput({ name: 'b' }));
    const c = defs.create(exampleDefinitionInput({ name: 'c' }));
    defs.create(exampleDefinitionInput({ name: 'never run' }));
    const run = (d: typeof a, over: { trigger?: 'manual' | 'schedule' | 'tool'; child?: boolean } = {}) => {
      const e = repo.create({
        definitionId: d.id,
        isChild: over.child === true,
        cell:
          over.child === true
            ? {
                origin: asIata('LHR'),
                destination: asIata('JFK'),
                departureDate: asIsoDate('2027-03-14'),
                returnDate: asIsoDate('2027-03-24'),
              }
            : null,
        snapshot: snapshotOf(d),
        estimate: null,
        trigger: over.trigger ?? 'manual',
        status: 'running',
      });
      repo.setStatus(e.id, 'completed', { finishedAt: clock.now() });
      return e.id;
    };
    run(a);
    clock.advance(1000);
    const aNew = run(a, { trigger: 'schedule' });
    clock.advance(1000);
    run(a, { child: true }); // a child after it is no parent
    // why: the same created_at twice; the later insert is the newer
    run(b);
    const bNew = run(b);
    clock.advance(1000);
    run(b, { trigger: 'tool' }); // a tool run after it is no search run
    run(c, { trigger: 'tool' }); // a definition with tool runs only has none
    const latest = repo.latestParentPerDefinition();
    expect([...latest.keys()].sort()).toEqual([a.id, b.id].sort());
    expect(latest.get(a.id)?.id).toBe(aNew);
    expect(latest.get(b.id)?.id).toBe(bNew);
    expect(latest.get(a.id)).toEqual(repo.get(aNew));
  });
});

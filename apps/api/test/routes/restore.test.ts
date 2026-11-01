// Spec revision 55 §10 `POST /definitions/:id/restore`: the undo of a remove brings the search back as it was, its
// schedule re-registered when it is scheduled; a live search answers 200 as it is (idempotent); a tool-only or unknown
// definition is 404 definition_not_found.
import { apiContract } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { exampleDefinitionInput, SMALL_WINDOW } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, seeder } from '../helpers/seed.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const restore = (x: Harness, id: string) => x.request(`/api/definitions/${id}/restore`, { method: 'POST' });
const jobsFor = (x: Harness, id: string) => x.engine.scheduler.jobs().filter((j) => j.definitionId === id);

describe('POST /definitions/:id/restore (revision 55 §10)', () => {
  it('restores a removed scheduled search: 200 with the live definition, its job registered again', async () => {
    h = await createHarness();
    const x = h;
    const created = await x.request('/api/definitions', {
      json: { ...exampleDefinitionInput({ window: SMALL_WINDOW }), scheduleCron: '0 5 * * 1', enabled: true },
    });
    expect(created.status).toBe(201);
    const { id } = apiContract.definitionResponseSchema.parse(await created.json());
    expect(jobsFor(x, id)).toHaveLength(1);
    expect((await x.request(`/api/definitions/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect(jobsFor(x, id)).toHaveLength(0);
    const r = await restore(x, id);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id, deletedAt: null, enabled: true, scheduleCron: '0 5 * * 1' });
    expect(jobsFor(x, id)).toHaveLength(1);
  });

  it('a live search is idempotent: 200 with the definition, unchanged, its job left as it was (final review ruling)', async () => {
    h = await createHarness();
    const x = h;
    const created = await x.request('/api/definitions', {
      json: { ...exampleDefinitionInput({ window: SMALL_WINDOW }), scheduleCron: '0 5 * * 1', enabled: true },
    });
    const live = apiContract.definitionResponseSchema.parse(await created.json());
    for (const _press of [1, 2]) {
      const r = await restore(x, live.id);
      expect(r.status).toBe(200);
      const body = apiContract.definitionResponseSchema.parse(await r.json());
      expect(body).toEqual(live);
      expect(jobsFor(x, live.id)).toHaveLength(1);
    }
    expect(x.ports.repos.definitions.get(live.id)?.updatedAt).toBe(live.updatedAt);
  });

  it('404 definition_not_found for a tool-only definition and an unknown id', async () => {
    h = await createHarness();
    const x = h;
    const tool = x.ports.repos.definitions.create(
      exampleDefinitionInput({ name: 'tool', window: SMALL_WINDOW }),
    );
    seeder(x.ports).execution('T', { def: tool, status: 'completed', startedAt: at(-1) });
    x.ports.db.raw
      .prepare("UPDATE search_executions SET trigger = 'tool' WHERE definition_id = ?")
      .run(tool.id);
    x.ports.repos.definitions.softDelete(tool.id);
    for (const id of [tool.id, 'no-such-definition']) {
      const r = await restore(x, id);
      expect(r.status).toBe(404);
      expect(await r.json()).toMatchObject({ error: { code: 'definition_not_found' } });
    }
  });
});

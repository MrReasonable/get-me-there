// Spec revision 55 §10 (sec-001): the cards, create-and-start and restore routes sit behind the auth gate like every
// route; the POSTs need X-Requested-With; the cards carry no error_text, key, password or path (the redaction sweep).
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { SENTINEL_AUTH } from '../helpers/env.js';
import { exampleDefinitionInput, SMALL_WINDOW } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, seeder } from '../helpers/seed.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const ROUTES = [
  { method: 'GET', path: '/api/definitions/cards' },
  { method: 'POST', path: '/api/definitions/create-and-start' },
  { method: 'POST', path: '/api/definitions/some-id/restore' },
] as const;

describe('the new routes behind the gate (revision 55 §10, sec-001)', () => {
  it.each(ROUTES)('$method $path answers 401 without credentials', async ({ method, path }) => {
    h = await createHarness();
    const r = await h.request(path, { method, auth: false, ...(method === 'POST' ? { json: {} } : {}) });
    expect(r.status).toBe(401);
  });

  it.each(ROUTES.filter((r) => r.method === 'POST'))(
    '$method $path answers 403 without X-Requested-With',
    async ({ method, path }) => {
      h = await createHarness();
      const r = await h.request(path, {
        method,
        body: JSON.stringify({ requestKey: randomUUID() }),
        headers: { 'content-type': 'application/json' },
        csrf: false,
      });
      expect(r.status).toBe(403);
    },
  );

  it('the cards carry no error_text, key, password or path', async () => {
    h = await createHarness();
    const x = h;
    const def = x.ports.repos.definitions.create(exampleDefinitionInput({ window: SMALL_WINDOW }));
    const s = seeder(x.ports);
    s.execution('E', { def, status: 'paused_error', startedAt: at(-1) });
    x.ports.repos.executions.patch(s.id('E'), {
      errorText: `worker said test-worker-key-0123456789abcdef0123456789abcdef at /home/operator/.local/state/db`,
    });
    const text = await (await x.request('/api/definitions/cards')).text();
    for (const leak of [
      'test-worker-key',
      SENTINEL_AUTH,
      '/home/operator',
      'errorText',
      'error_text',
      'worker said',
    ])
      expect(text).not.toContain(leak);
  });
});

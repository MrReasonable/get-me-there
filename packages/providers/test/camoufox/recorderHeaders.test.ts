import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { createRecorder } from '../../src/http/recorder.js';
import { ALL_SECRETS, req, SENTINELS } from '../fakes.js';

describe('the recorder drops the worker key (arch-013: x-gmt-worker-key is a credential header)', () => {
  it('a recorded camoufox request has no x-gmt-worker-key', async () => {
    const root = join(mkdtempSync(join(tmpdir(), 'gmt-rec-')), 'fixtures', 'recorded');
    mkdirSync(root, { recursive: true });
    const recorder = createRecorder({
      root,
      secrets: ALL_SECRETS,
      clock: fixedClock(asIsoDateTime('2026-10-18T05:00:00.000Z')),
      recordedBy: 'wp14-test',
    });
    const path = await recorder.record({
      providerId: 'camoufox',
      endpointPath: '/v1/page',
      request: req({
        url: 'http://127.0.0.1:8090/v1/page',
        providerId: 'camoufox',
        method: 'POST',
        headers: { 'x-gmt-worker-key': SENTINELS.camoufox.reveal(), 'content-type': 'application/json' },
        body: '{"mode":"list"}',
      }),
      status: 200,
      body: { kind: 'spacing', retryAfterSeconds: 3 },
      fetchedAt: asIsoDateTime('2026-10-18T05:00:00.000Z'),
    });
    const text = readFileSync(path, 'utf8');
    expect(text).not.toMatch(/x-gmt-worker-key/i);
    expect(text).not.toContain(SENTINELS.camoufox.reveal());
  });
});

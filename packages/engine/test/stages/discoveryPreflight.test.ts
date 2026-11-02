// Spec revision 56 §8.1 "The plan": the discovery preflight's result carries the worker's reported flags (every read
// that returned a status, ok or refused), and the engine keeps them per provider: the flight-list step plans its return
// phase from them. Stub providers through the real engine (test/support/camoufox.ts); no timers.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { engineWith, realTime, stubCamoufox } from '../support/camoufox.js';

beforeEach(realTime);
afterEach(realTime);

const FLAGS = { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: false };

describe('the discovery preflight sets ctx.workerFlags (spec rev 56 §8.1)', () => {
  it('an ok preflight with flags sets them for camoufox', async () => {
    const cam = stubCamoufox({ cells: 3, preflight: { ok: true, flags: FLAGS } });
    const e = engineWith([cam]);
    expect(e.ctx.workerFlags.get('camoufox')).toBeNull();
    await e.runToEnd();
    expect(e.ctx.workerFlags.get('camoufox')).toEqual(FLAGS);
  });

  it('a refused preflight that read a status sets them too; one without flags sets none', async () => {
    const refused = engineWith([
      stubCamoufox({
        cells: 3,
        preflight: { ok: false, skip: 'provider_disabled', detail: 'cooling down', flags: FLAGS },
      }),
    ]);
    await refused.runToEnd();
    expect(refused.ctx.workerFlags.get('camoufox')).toEqual(FLAGS);
    const unreachable = engineWith([
      stubCamoufox({
        cells: 3,
        preflight: { ok: false, skip: 'provider_unavailable', detail: 'not answering' },
      }),
    ]);
    await unreachable.runToEnd();
    expect(unreachable.ctx.workerFlags.get('camoufox')).toBeNull();
  });
});

// Fix round 1 (arch M5, M6): the refused-connection reading and the unledgered id set, at every branch.
import { beforeEach, describe, expect, it } from 'vitest';
import { connectionRefused } from '../../src/http/classify.js';
import { errorProviderId, ledgeredId, UNLEDGERED_IDS } from '../../src/http/types.js';

const failed = (cause: unknown) => new TypeError('fetch failed', { cause });

beforeEach(() => {
  expect.hasAssertions();
});

describe('connectionRefused', () => {
  it.each([
    ['ECONNREFUSED', failed({ code: 'ECONNREFUSED' }), true],
    ['EHOSTUNREACH', failed({ code: 'EHOSTUNREACH' }), true],
    ['another code', failed({ code: 'ECONNRESET' }), false],
    ['no cause', new TypeError('fetch failed'), false],
    ['not an Error', { cause: { code: 'ECONNREFUSED' } }, false],
    // why: undici reports a refused dual-stack localhost as an AggregateError of one refusal per address
    [
      'an AggregateError of refusals',
      failed(new AggregateError([{ code: 'ECONNREFUSED' }, { code: 'EHOSTUNREACH' }])),
      true,
    ],
    [
      'an AggregateError with one other code',
      failed(new AggregateError([{ code: 'ECONNREFUSED' }, { code: 'ETIMEDOUT' }])),
      false,
    ],
    ['an empty AggregateError', failed(new AggregateError([])), false],
  ])('%s → %s', (_n, err, expected) => {
    expect(connectionRefused(err)).toBe(expected);
  });
});

describe('UNLEDGERED_IDS (the one list ledgeredId reads)', () => {
  it('every unledgered id is never ledgered; every provider id is', () => {
    for (const id of UNLEDGERED_IDS) expect(ledgeredId(id), id).toBeNull();
    for (const id of ['travelpayouts', 'searchapi', 'camoufox', 'fixture'] as const)
      expect(ledgeredId(id)).toBe(id);
    expect(errorProviderId('camoufox-status')).toBe('camoufox');
    expect(errorProviderId('fx')).toBe('fx');
  });
});

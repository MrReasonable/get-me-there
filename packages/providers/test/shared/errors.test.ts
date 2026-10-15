import { ProviderError } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseError, parseVendor } from '../../src/shared/errors.js';
import { asProviderError } from '../support/guards.js';

const where = { providerId: 'travelpayouts', endpointPath: '/aviasales/v3/prices_for_dates' } as const;

describe('parseError (plan decision 24: one shared parse error, consistent with the fixture provider)', () => {
  it("is a non-retryable parse error whose reason is the kind-level 'parse' and whose message carries the cause", () => {
    const e = parseError('currency-missing', null, where);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e).toMatchObject({
      kind: 'parse',
      retryable: false,
      reason: 'parse',
      providerId: 'travelpayouts',
    });
    expect(e.message).toBe(
      'travelpayouts /aviasales/v3/prices_for_dates: currency-missing [currency-missing]',
    );
  });

  it('puts vendor detail in the message only, URL-stripped, control characters removed, capped at 200 characters', () => {
    const e = parseError(
      'vendor-error',
      `bad\nrequest https://api.example.test/x?token=abc ${'y'.repeat(300)}`,
      where,
    );
    expect(e.reason).toBe('parse');
    expect(e.message).not.toContain('\n');
    expect(e.message).not.toContain('token=abc');
    expect(e.message).toContain('https://api.example.test/x');
    expect(e.message.endsWith(' [vendor-error]')).toBe(true);
    expect(e.message.length).toBeLessThan(260);
  });
});

describe('parseVendor (zod over untrusted vendor JSON, no casts)', () => {
  const schema = z.object({ success: z.literal(true), data: z.array(z.unknown()) });

  it('returns the typed value', () => {
    expect(parseVendor(schema, { success: true, data: [1] }, 'malformed-envelope', where)).toEqual({
      success: true,
      data: [1],
    });
  });

  it('throws parseError naming the failed fields, never their values', () => {
    let caught: unknown;
    try {
      parseVendor(schema, { success: true, data: 'secret-looking-value' }, 'malformed-envelope', where);
    } catch (e) {
      caught = e;
    }
    const e = asProviderError(caught);
    expect(e).toMatchObject({ kind: 'parse', reason: 'parse' });
    expect(e.message).toContain('data:');
    expect(e.message).toContain('[malformed-envelope]');
    expect(e.message).not.toContain('secret-looking-value');
  });
});

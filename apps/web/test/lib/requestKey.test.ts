import { apiContract } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newRequestKey } from '../../src/lib/requestKey.js';

// Spec rev 55 §10 (WP20 Task 20.5): each Search now press carries a fresh version 4 UUID, accepted by the contract,
// without `crypto.randomUUID` (absent outside a secure context, such as plain HTTP on a home network).

afterEach(() => vi.unstubAllGlobals());

describe('newRequestKey', () => {
  it('is a version 4, variant 10 UUID the create-and-start contract accepts', () => {
    const key = newRequestKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(apiContract.createAndStartRequestSchema.shape.requestKey.safeParse(key).success).toBe(true);
  });

  it('is fresh each time', () => {
    const keys = new Set(Array.from({ length: 50 }, () => newRequestKey()));
    expect(keys.size).toBe(50);
  });

  it('sets the version and variant bits whatever the random bytes are, and needs no randomUUID', () => {
    for (const fill of [0x00, 0xff]) {
      vi.stubGlobal('crypto', {
        getRandomValues: (a: Uint8Array) => a.fill(fill),
      });
      expect(newRequestKey()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
    expect(newRequestKey()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });
});

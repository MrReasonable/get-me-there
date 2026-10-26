import { describe, expect, it } from 'vitest';
import { CONSENT_FIX, consentFixText } from '../../src/camoufox/consentFix.js';

describe('the consent fix (review V1; WP17 Task 17.5)', () => {
  it('names the guided capture and the guide section', () => {
    expect(CONSENT_FIX).toEqual({
      command: 'pnpm gmt consent',
      doc: 'docs/setup.md#capture-your-consent-choice',
    });
  });
  it('words it as one sentence', () => {
    expect(consentFixText()).toBe(
      'capture consent again with pnpm gmt consent (docs/setup.md#capture-your-consent-choice)',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { CONSENT_FIX, consentFixText } from '../../src/camoufox/consentFix.js';

describe('the consent fix (review V1)', () => {
  it('names the capture script that exists and the guide section, and no pnpm gmt command', () => {
    expect(CONSENT_FIX).toEqual({
      command: 'pnpm --filter @gmt/camoufox-worker capture-socs',
      doc: 'docs/setup.md#capture-your-consent-choice',
    });
    expect(CONSENT_FIX.command.startsWith('pnpm gmt')).toBe(false);
  });
  it('words it as one sentence', () => {
    expect(consentFixText()).toBe(
      'capture consent again with pnpm --filter @gmt/camoufox-worker capture-socs (docs/setup.md#capture-your-consent-choice)',
    );
  });
});

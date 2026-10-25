/**
 * Where a consent record is captured (review V1): the one constant the Status view's consent card, the worker card's
 * `consent-*` refusals, the consent email and the worker's own refusals all use. A command that exists, and the guide's
 * section that walks through it, shared by WP17 and WP18. Since WP17 Task 17.5 it is the guided capture, `pnpm gmt
 * consent` (a visible window, the person's own click on "Reject all", the choice checked from the cookie's value);
 * `capture-socs` stays the lighter equal option the guide names beside it.
 */
export const CONSENT_FIX = {
  command: 'pnpm gmt consent',
  doc: 'docs/setup.md#capture-your-consent-choice',
} as const;

/** The fix as one sentence, for a report's fix text. */
export const consentFixText = (): string =>
  `capture consent again with ${CONSENT_FIX.command} (${CONSENT_FIX.doc})`;

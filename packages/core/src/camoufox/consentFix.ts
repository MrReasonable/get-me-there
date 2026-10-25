/**
 * Where a consent record is captured today (review V1): the one constant the Status view's consent card, the worker
 * card's `consent-*` refusals and the consent email all use. A command that exists, and the guide's section that walks
 * through it, shared by WP17 and WP18; WP17 changes this one constant when the guided capture (Task 17.5) lands.
 */
export const CONSENT_FIX = {
  command: 'pnpm --filter @gmt/camoufox-worker capture-socs',
  doc: 'docs/setup.md#capture-your-consent-choice',
} as const;

/** The fix as one sentence, for a report's fix text (it is not a `pnpm gmt` command, so no card carries it as one). */
export const consentFixText = (): string =>
  `capture consent again with ${CONSENT_FIX.command} (${CONSENT_FIX.doc})`;

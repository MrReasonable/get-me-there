/**
 * Where a consent record is captured today (review V1): the one constant the Status view's consent card, the worker
 * card's `consent-*` refusals and the consent email all use. A command that exists, and the guide's section that walks
 * through it. WP17 changes this one constant if it ships a `pnpm gmt consent`.
 */
export const CONSENT_FIX = {
  command: 'pnpm --filter @gmt/camoufox-worker capture-socs',
  doc: 'docs/setup.md#set-it-up-macos',
} as const;

/** The fix as one sentence, for a report's fix text (it is not a `pnpm gmt` command, so no card carries it as one). */
export const consentFixText = (): string =>
  `capture consent again with ${CONSENT_FIX.command} (${CONSENT_FIX.doc})`;

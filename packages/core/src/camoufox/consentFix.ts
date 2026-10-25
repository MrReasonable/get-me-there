/**
 * The consent fix every operator-facing text names until the guided capture (`gmt consent`, brief WP17 Task 17.5)
 * lands (W2): the worker's own capture command and the setup section that walks through it. WP17 and WP18 share this
 * one constant; no text names a consent command that does not exist yet.
 */
export const CONSENT_FIX = {
  command: 'pnpm --filter @gmt/camoufox-worker capture-socs',
  doc: 'docs/setup.md#capture-your-consent-choice',
} as const;

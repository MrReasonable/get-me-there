/**
 * History's own URL parameters, beside WP9's URL state (review arch2-011), so a link to History never imports the
 * History view module and its chart library.
 */
export const HISTORY_PARAMS = { hash: 'hash', pair: 'hist.pair' } as const;

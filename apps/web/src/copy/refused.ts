/**
 * A refused Search now's words on the new search's page (`refused=<code>`; spec rev 55 §11, Review Focus 1, ruling A24;
 * WP20 Task 20.5), from the refusal's code alone, never the engine's message. Apart from `src/copy.ts`, as the plan and
 * set-up words are; `test/copy/estimateCatalogue.test.ts` sweeps them.
 */
export const REFUSED_COPY = {
  disabled: 'No price source is set up, so nothing was searched',
  disabledFix: 'Set up a price source (Providers)',
  capResets: (date: string) => `This month's limit is used up; it resets on ${date}`,
  cap: 'A spending limit stops this search from starting',
  window: 'Nothing to search: the dates have passed',
  'shutting-down': 'The app is restarting; try again in a moment',
  failed: 'The search was saved but could not start',
  confirm: 'Check the estimate, then search again',
  edit: 'Edit',
} as const;

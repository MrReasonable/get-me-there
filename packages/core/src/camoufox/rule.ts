import { z } from 'zod';

/**
 * The rule that stopped a page (spec §2 "Navigation and the stops"; revision 56 "The return phase"): the classifier's
 * rule (`cheapest-tab-count`), a check's (`search-form:mismatch`, `currency`), a grid step's (`grid:first-view:price`)
 * or a return phase step's (`reload:not-settled`, `more-options-count`). A bounded token of lower-case words joined by
 * `:`, so it can never carry page text, a name or a URL; the app shows it in `last_error`.
 *
 * why: a leaf (imports nothing of this package), so `flights/returns.ts` and `api-contract/executions.ts` can name the
 * rule without importing the protocol, which itself imports `flights/` (no import cycle; spec rev 56 R-order).
 */
export const workerRuleSchema = z
  .string()
  .max(80)
  .regex(/^[a-z][a-z0-9-]*(?::[a-z0-9-]+)*$/);

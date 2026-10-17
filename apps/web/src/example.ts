import { apiContract } from '@gmt/core';
import example from '../../../docs/examples/london-new-york.json' with { type: 'json' };

/**
 * Spec §1 / §11 "import example": the worked example as a create body, and the one place its words
 * live. The airport codes are in docs/examples/london-new-york.json (WP12 owns the file and the
 * equality test); this is the one apps/web/src file allowed to name the example's places, which
 * scripts/check-boundaries.mjs enforces (decision 36). Parsed with the contract, so drift fails at load.
 */
export const EXAMPLE_DEFINITION = apiContract.definitionCreateRequestSchema.parse(example);

/** The example's route in words, for the import button; copy.ts takes it as an argument. */
export const EXAMPLE_LABEL = 'London to New York';

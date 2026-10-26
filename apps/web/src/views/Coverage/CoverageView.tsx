import type { DefinitionResponse } from '../../api/types.js';
import { CoverageBody } from '../Dates/CoverageSection.js';

/**
 * View D until Task 19.8 retires it: its body moved to the Dates view's coverage section (WP19 §4), which this view
 * now renders whole, so the two never differ.
 */
export function CoverageView({ definition }: { definition: DefinitionResponse }) {
  return <CoverageBody definition={definition} />;
}

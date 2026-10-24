import type { Action, ApplyResult, Executor, Plan } from './action.js';

/**
 * Runs a plan's actions in order and stops at the first that throws: what ran is `done`, the one that failed is
 * `failed` with its error text, the rest is `notRun`. Nothing is rolled back and nothing is recorded on disk (decision
 * 72): a re-run of the command plans again from the machine as it now is.
 */
export async function apply(plan: Plan, ex: Executor): Promise<ApplyResult> {
  const done: Action[] = [];
  for (const [i, action] of plan.actions.entries()) {
    try {
      await ex.run(action);
    } catch (e) {
      return { done, failed: { action, error: errorText(e) }, notRun: plan.actions.slice(i + 1) };
    }
    done.push(action);
  }
  return { done, failed: null, notRun: [] };
}

/** An error's message, never its stack or a cause chain (which could hold a child's input). */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

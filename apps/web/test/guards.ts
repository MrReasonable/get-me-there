/**
 * Failures that would otherwise be swallowed: an unmatched request (TanStack Query turns it into a
 * query error, so a negative assertion could pass vacuously, review tsr-004) and console.error
 * (React act warnings, boundary reports). test/setup.ts throws in afterEach when either occurred,
 * unless the test announced, with expectConsoleErrors(pattern), the console.error it causes on purpose;
 * an error that does not match the pattern still fails, and so does a pattern that never occurred
 * (review tsr2-006).
 */
export const unhandled: string[] = [];
export const consoleErrors: unknown[][] = [];
let expected: RegExp | null = null;

/** A test that renders a broken price or a crashing view announces the console.error it expects. */
export function expectConsoleErrors(pattern: RegExp): void {
  expected = pattern;
}

/** What the finished test left behind that should fail it; resets the per-test state. */
export function drainGuards(): string[] {
  const text = consoleErrors.map((a) => a.map(String).join(' '));
  const problems = [
    ...unhandled.map((u) => `request no handler matched: ${u}`),
    ...text
      .filter((t) => expected === null || !expected.test(t))
      .map((t) => `console.error during the test: ${t}`),
    ...(expected !== null && !text.some((t) => expected?.test(t) === true)
      ? [`expected console.error ${expected} never occurred`]
      : []),
  ];
  unhandled.length = 0;
  consoleErrors.length = 0;
  expected = null;
  return problems;
}

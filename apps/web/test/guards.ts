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

// The rendered-copy sweep's two collectors, shared by WP9's sweep and WP10's wiring test (review arch2-012).

/** Every visible string plus the attributes a screen reader or tooltip shows. */
export function renderedCopy(): string {
  const attrs = [...document.body.querySelectorAll('[title], [aria-label], [placeholder], [alt]')].flatMap(
    (el) => ['title', 'aria-label', 'placeholder', 'alt'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [document.body.textContent ?? '', ...attrs].join('\n');
}

/**
 * Every "£" in the DOM sits inside a PriceCell (a fare, with provenance), a [data-cost] element (a cost
 * or a cap), a [data-quote] element (a price quoted in text: an alert threshold or firing reason, decision 55), a [data-scale] element (WP10: the heatmap legend's band ranges, scale values only; no fare is ever
 * exempt, chart tooltips included, and chart axes print no "£": plan decision 52), a [data-indicative] row (WP10:
 * a route-level series, exempt from full provenance by spec §11) or a form label ("Max price (£)"), on every view
 * (reviews tsr-003, prov-r2-007).
 */
export function poundsOutsidePrices(): string[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const outside: string[] = [];
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const host = n.parentElement;
    if (
      n.textContent?.includes('£') &&
      host?.closest(
        '[data-testid="price-cell"], [data-cost], [data-scale], [data-indicative], [data-quote], label',
      ) === null
    ) {
      outside.push(n.textContent);
    }
  }
  return outside;
}

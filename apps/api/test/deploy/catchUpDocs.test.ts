// Spec §8.2 rev 36 and plan decisions 79, 82 and 83 in the operator docs (WP16a Task 16a.7): the catch-up rule, the
// browser window in the one sentence decision 83 pins, and the two-apps line of docs/api-limits.md.
import { beforeEach, describe, expect, it } from 'vitest';
import { read } from './files.js';

beforeEach(() => {
  expect.hasAssertions();
});

const flat = (path: string): string => read(path).replace(/\s+/g, ' ');

describe('docs/scheduling.md: catch-up and the browser window (decisions 79, 83)', () => {
  it('states the catch-up rule: once, a late tick is a catch-up, the half-gap skip by its own gap, the machine awake', () => {
    const doc = flat('docs/scheduling.md');
    expect(doc).toContain('at most once, never twice');
    expect(doc).toContain('A timer that fires more than 2 minutes after its firing is treated as a catch-up');
    expect(doc).toContain("less than half of that firing's own gap (the next firing minus the missed one");
    expect(doc).toContain('A run needs the machine awake');
    expect(doc).toContain('A catch-up never loads browser pages. It still copies');
    expect(doc).toContain('Resumes, at boot or after the machine wakes, follow the browser window below.');
  });

  it('pins "a catch-up never loads browser pages" and makes no "hours the operator chose" claim', () => {
    const doc = flat('docs/scheduling.md');
    expect(doc.toLowerCase()).toContain('a catch-up never loads browser pages');
    expect(doc.toLowerCase()).not.toContain('hours the operator chose');
    expect(doc).not.toContain('The scheduler does not catch up');
  });

  it('states the browser window in decision 83’s sentence, naming the setting and its default', () => {
    expect(flat('docs/scheduling.md')).toContain(
      "By default (CAMOUFOX_BROWSER_WINDOW=scheduled), browser pages load only inside a run's window: from its scheduled time, or its start when that is later (a manual run's start), to 1.5 times its estimated duration later. The window is checked at a run's first browser page, at a resume, or after the machine has slept, never while a run keeps going; a run that resumes or wakes after its window leaves the browser provider's remaining cells for the next scheduled run (or, when the definition has no schedule, for your next run of it), while SearchApi and Travelpayouts carry on. With CAMOUFOX_BROWSER_WINDOW=any, a resumed run keeps loading browser pages, within every cap, spacing and cool-down. A catch-up never loads browser pages either way.",
    );
  });
});

describe('docs/api-limits.md: two apps on one key (decision 82)', () => {
  it('pins the line', () => {
    expect(flat('docs/api-limits.md')).toContain(
      "With two apps on one SearchApi key, the stop is SearchApi's own quota, not this app's ledger; the money ceiling holds only because the 40usd plan has no overage.",
    );
  });
});

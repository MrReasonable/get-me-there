import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast } from '../../contrast.js';

// Design 2026-11-08 §5.1 (trip-page plan Task 7; moved by Task 4): the shared tokens (styles/theme.css), light and dark, read
// from the stylesheet itself. The stale age's amber reads at 4.5:1 on every label's ground, and every text pair the
// page uses reads at WCAG AA, in both schemes.

const css = readFileSync(join(import.meta.dirname, '../../../src/styles/theme.css'), 'utf8');
const light = /\n:root \{([^}]*)\}/.exec(css)?.[1] ?? '';
const dark = /@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/.exec(css)?.[1] ?? '';

function tokenIn(block: string, name: string): string {
  const m = new RegExp(`--t-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block);
  if (m?.[1] === undefined) throw new Error(`no --t-${name} in the block`);
  return m[1];
}

const SCHEMES = [
  ['light', light],
  ['dark', dark],
] as const;
const HEATS = ['heat-1', 'heat-2', 'heat-3', 'heat-4', 'heat-5'] as const;
const LABEL_GROUNDS = ['seller-bg', 'google-bg', 'cal-bg', 'cache-bg', 'surface'] as const;

describe('the Trip page’s colours (WCAG AA, light and dark)', () => {
  it('both blocks are read', () => {
    expect(light).toContain('--t-warn');
    expect(dark).toContain('--t-warn');
  });

  it.each(SCHEMES)('%s: the stale age’s amber reads at 4.5:1 on every label’s ground', (_scheme, block) => {
    for (const g of LABEL_GROUNDS)
      expect(contrast(tokenIn(block, 'warn'), tokenIn(block, g)), g).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SCHEMES)('%s: each label’s ink on its own ground', (_scheme, block) => {
    for (const k of ['seller', 'google', 'cal', 'cache'])
      expect(contrast(tokenIn(block, `${k}-ink`), tokenIn(block, `${k}-bg`)), k).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokenIn(block, 'old-ink'), tokenIn(block, 'surface'))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SCHEMES)(
    '%s: ink, muted ink, links and the bad line on the page and its cards; the button’s words',
    (_scheme, block) => {
      for (const ink of ['ink', 'muted', 'accent', 'bad'])
        for (const g of ['surface', 'bg'])
          expect(contrast(tokenIn(block, ink), tokenIn(block, g)), `${ink} on ${g}`).toBeGreaterThanOrEqual(
            4.5,
          );
      expect(contrast(tokenIn(block, 'accent-ink'), tokenIn(block, 'accent'))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokenIn(block, 'accent-ink'), tokenIn(block, 'accent-hover'))).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );

  it.each(SCHEMES)('%s: every heat step reads at 4.5:1 with one of the two heat inks', (_scheme, block) => {
    for (const h of HEATS) {
      const ground = tokenIn(block, h);
      const best = Math.max(
        contrast(tokenIn(block, 'heat-ink-dark'), ground),
        contrast(tokenIn(block, 'heat-ink-light'), ground),
      );
      expect(best, h).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(SCHEMES)(
    '%s: the focus ring, a not-seen edge, ok and bad read at 3:1 or more on the page and its cards',
    (_scheme, block) => {
      for (const g of ['surface', 'bg']) {
        expect(contrast(tokenIn(block, 'focus'), tokenIn(block, g)), `focus on ${g}`).toBeGreaterThanOrEqual(
          3,
        );
        expect(
          contrast(tokenIn(block, 'old-line'), tokenIn(block, g)),
          `old-line on ${g}`,
        ).toBeGreaterThanOrEqual(3);
      }
      for (const k of ['ok', 'bad'])
        expect(contrast(tokenIn(block, k), tokenIn(block, 'surface')), k).toBeGreaterThanOrEqual(4.5);
    },
  );
});

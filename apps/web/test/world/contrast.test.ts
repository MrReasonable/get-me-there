import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrast } from '../contrast.js';

// The departure board's text pairs (styles/world.css): every token the world's text uses, read from the stylesheet
// itself, against every ground it sits on, at WCAG AA (4.5:1 for text). Amber and the dim red are lamps on black: they
// are never paired with enamel or steel, so a light-ground "failed" or "warn" uses its own dark ink.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/styles/world.css'), 'utf8');
function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css);
  if (m?.[1] === undefined) throw new Error(`no --${name} in world.css`);
  return m[1];
}

const LIGHT_GROUNDS = ['steel', 'enamel', 'enamel-lo', 'field', 'steel-hi'] as const;
const DARK_GROUNDS = ['board', 'flap-top', 'flap-bot', 'board-2', 'lamp-off'] as const;

describe('the departure board’s text contrast (WCAG AA)', () => {
  it.each(['ink', 'ink-2', 'ink-bad', 'ink-warn'])('--%s reads at 4.5:1 on every light ground', (ink) => {
    for (const g of LIGHT_GROUNDS)
      expect(contrast(token(ink), token(g)), `${ink} on ${g}`).toBeGreaterThanOrEqual(4.5);
  });

  it('--ink-3, a hint ink, reads at 4.5:1 on enamel', () => {
    for (const g of ['enamel', 'enamel-lo', 'field'] as const)
      expect(contrast(token('ink-3'), token(g)), g).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['flap-ink', 'flap-ink-2', 'amber', 'red', 'dim'])(
    '--%s reads at 4.5:1 on every dark ground',
    (ink) => {
      for (const g of DARK_GROUNDS)
        expect(contrast(token(ink), token(g)), `${ink} on ${g}`).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('amber and the dim red never pass on enamel, which is why they stay on black', () => {
    expect(contrast(token('amber'), token('enamel'))).toBeLessThan(4.5);
    expect(contrast(token('red'), token('enamel'))).toBeLessThan(4.5);
  });

  it('the alarm banner’s white words read at 4.5:1 on its red', () => {
    expect(contrast('#ffffff', token('alarm'))).toBeGreaterThanOrEqual(4.5);
  });
});

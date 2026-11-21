import { WINDOW_PRESET_MONTHS, WINDOW_PRESET_OFFSET_DAYS } from '@gmt/core';
import type { DraftWindow } from './draft.js';

/** One of the rolling presets, in calendar months ("Next 3 months" is 3). */
export type PresetMonths = (typeof WINDOW_PRESET_MONTHS)[number];

/**
 * Spec §11 "When to leave": what the choice list shows for a window. A preset (a months window starting
 * `WINDOW_PRESET_OFFSET_DAYS` ahead for 1, 3, 6, 9 or 12 months), "Set date range" (an absolute window), or "custom":
 * any other rolling window, which a search saved before the presets (or written through the API) may hold.
 */
export type WindowChoice = PresetMonths | 'range' | 'custom';

/** The choice a window reads as. */
export function windowChoice(w: DraftWindow): WindowChoice {
  if (w.kind === 'absolute') return 'range';
  if (w.kind === 'months' && w.startOffsetDays === WINDOW_PRESET_OFFSET_DAYS) {
    const preset = WINDOW_PRESET_MONTHS.find((n) => n === w.lengthMonths);
    if (preset !== undefined) return preset;
  }
  return 'custom';
}

/** The months window a preset stores. */
export function presetWindow(months: PresetMonths): DraftWindow {
  return { kind: 'months', startOffsetDays: WINDOW_PRESET_OFFSET_DAYS, lengthMonths: months };
}

/** A choice as the select's value ("3", "range", "custom"), and back; null for a value no option has. */
export const choiceValue = (c: WindowChoice): string => String(c);
export function choiceOf(value: string): WindowChoice | null {
  if (value === 'range' || value === 'custom') return value;
  return WINDOW_PRESET_MONTHS.find((n) => String(n) === value) ?? null;
}

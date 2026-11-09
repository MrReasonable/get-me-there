import {
  effectiveAge,
  formatAgeFull,
  formatDuration,
  type PriceLabelKind,
  type StaleMark,
  staleWords,
} from '@gmt/core';
import { type KeyboardEvent, useRef } from 'react';
import { COPY } from '../copy.js';
import { useNow } from '../now.js';
import { assertProvenance } from './Provenance.js';

const T = COPY.trip;

export interface PriceLabelProps {
  kind: PriceLabelKind;
  /** The wire's effective age of the price (`ageHours`), shown as the board shows ages ("3h", "2d"). */
  ageHours: number | 'unknown';
  /** The wire's stale mark, never recomputed: anything but `false` turns the age amber and says so. */
  stale: StaleMark;
  /** The price's provenance, validated here; its full age (core's `formatAgeFull`) is the detail's second line. */
  provenance: unknown;
  /** What the price is, in one or two sentences (design §5.1's tap detail for this kind). */
  detail: string;
}

/** A label's age as the board words it: "3h", "2d", "just now", or "age unknown". */
export function labelAge(ageHours: number | 'unknown'): string {
  return ageHours === 'unknown' ? COPY.ageUnknown : formatDuration(ageHours);
}

/**
 * Design 2026-11-08 §5.1: a price's one label, `Kind · age`, and one tap down its two-line detail: what the price is,
 * then how old it is in full, so an unknown or assumed vendor age is said there. A disclosure (`<details>`), so it is
 * keyboard operable with no script; Escape closes it and returns focus to the label. The age turns amber once the wire
 * marks the price stale, and the label's spoken name then says why.
 */
export function PriceLabel({ kind, ageHours, stale, provenance, detail }: PriceLabelProps) {
  const now = useNow();
  const p = assertProvenance(provenance);
  const ref = useRef<HTMLDetailsElement>(null);
  const age = labelAge(ageHours);
  const text = T.labelText(T.label[kind], age);
  const close = (e: KeyboardEvent<HTMLDetailsElement>) => {
    const d = ref.current;
    if (e.key !== 'Escape' || d === null || !d.open) return;
    d.open = false;
    d.querySelector('summary')?.focus();
  };
  return (
    // why: the key handler closes the disclosure its own summary opened; a details element is itself interactive
    <details ref={ref} className={`price-label k-${kind}`} data-testid="price-label" onKeyDown={close}>
      <summary aria-label={stale === false ? undefined : T.labelStale(text, staleWords(stale))}>
        {T.labelText(T.label[kind], '')}
        <span className={stale === false ? undefined : 'price-label-stale'}>{age}</span>
      </summary>
      <div className="price-label-pop">
        <p>{detail}</p>
        <p className="price-label-age">{formatAgeFull(effectiveAge(p, now))}</p>
      </div>
    </details>
  );
}

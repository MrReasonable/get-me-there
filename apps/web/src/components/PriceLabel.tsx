import {
  effectiveAge,
  formatAgeFull,
  formatDuration,
  type PriceLabelKind,
  type StaleMark,
  staleWords,
} from '@gmt/core';
import { useEffect, useRef } from 'react';
import { COPY } from '../copy.js';
import { useNow } from '../now.js';
import { PriceBoundary } from './PriceBoundary.js';
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
  /** What the price is, in one or two sentences (design §5.1's tap detail for this kind), its age left to the line below. */
  detail: string;
}

/** A label's age as the board words it: "3h", "2d", "just now", or "age unknown". */
export function labelAge(ageHours: number | 'unknown'): string {
  return ageHours === 'unknown' ? COPY.ageUnknown : formatDuration(ageHours);
}

function Label({ kind, ageHours, stale, provenance, detail }: PriceLabelProps) {
  const now = useNow();
  const p = assertProvenance(provenance);
  const ref = useRef<HTMLDetailsElement>(null);
  const age = labelAge(ageHours);
  const text = T.labelText(T.label[kind], age);
  // why: Escape closes an open detail wherever focus is (a clicked summary takes no focus in some browsers), and puts
  // focus back on its label when focus was inside it or nowhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = ref.current;
      if (e.key !== 'Escape' || d === null || !d.open) return;
      d.open = false;
      const active = document.activeElement;
      if (active === null || active === document.body || d.contains(active))
        d.querySelector('summary')?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <details ref={ref} className={`price-label k-${kind}`} data-testid="price-label">
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

/**
 * Design 2026-11-08 §5.1: a price's one label, `Kind · age`, and one tap down its two-line detail: what the price is,
 * then how old it is in full (once, from its provenance), so an unknown or assumed vendor age is said there. A
 * disclosure (`<details>`) that opens in the flow beneath its label, so it covers nothing; Escape closes it. The age
 * turns amber once the wire marks the price stale, and the label's spoken name then says why. The label sits in its
 * own price boundary: a provenance that is not one withholds this label alone, never the page.
 */
export function PriceLabel(props: PriceLabelProps) {
  return (
    <PriceBoundary>
      <Label {...props} />
    </PriceBoundary>
  );
}

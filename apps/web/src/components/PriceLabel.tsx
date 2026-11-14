import {
  effectiveAge,
  formatAgeFull,
  formatDuration,
  hoursSince,
  type IsoDateTime,
  mainPathSource,
  type PriceLabelKind,
  pointOfSaleLabel,
  type StaleMark,
  staleWords,
} from '@gmt/core';
import { useEffect, useRef, useState } from 'react';
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

/**
 * The wire's age advanced by the hours the page's clock has moved since that age arrived, so the label keeps pace with
 * its detail's full age (CodeRabbit PR #58 finding 4). why: the wire's age is the effective age at the server's clock,
 * which advances one for one with time whatever its kind, so counting on from it never recomputes the rule; an unknown
 * age stays unknown. A new age or a new observation from the wire starts the count again (React's "adjust state on a
 * prop change" pattern).
 */
function useAdvancedAge(
  ageHours: number | 'unknown',
  fetchedAt: IsoDateTime,
  now: IsoDateTime,
): number | 'unknown' {
  const [base, setBase] = useState({ ageHours, fetchedAt, at: now });
  // why: a replacement observation can arrive with the same wire age, so the observation's fetch time is part of the key
  if (base.ageHours !== ageHours || base.fetchedAt !== fetchedAt) {
    setBase({ ageHours, fetchedAt, at: now });
    return ageHours;
  }
  return ageHours === 'unknown' ? 'unknown' : ageHours + hoursSince(base.at, now);
}

function Label({ kind, ageHours, stale, provenance, detail }: PriceLabelProps) {
  const now = useNow();
  const p = assertProvenance(provenance);
  const ref = useRef<HTMLDetailsElement>(null);
  const age = labelAge(useAdvancedAge(ageHours, p.fetchedAt, now));
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
        <p data-testid="label-source" className="price-label-age">
          {T.labelSource(mainPathSource(p.providerId))}
        </p>
        <p data-testid="point-of-sale" className="price-label-age">
          {pointOfSaleLabel(p)}
        </p>
        {p.fx.converted ? (
          <p data-testid="label-fx" className="price-label-age">
            {COPY.fxTitle(p.fx.rateDate, p.fx.source)}
          </p>
        ) : null}
      </div>
    </details>
  );
}

/**
 * Design 2026-11-08 §5.1: a price's one label, `Kind · age`, and one tap down its detail: what the price is, then how
 * old it is in full (once, from its provenance), so an unknown or assumed vendor age is said there, its source (the
 * provider, by its main-path name), the market it was read in (point of sale) and, for a converted price, the rate (spec rev 69). A
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

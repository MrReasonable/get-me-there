import {
  effectiveAge,
  formatAgeCompact,
  formatAgeFull,
  type Provenance as ProvenanceT,
  pointOfSaleLabel,
  provenanceSchema,
  type SourceKind,
  sourceLabel,
} from '@gmt/core';
import { COPY } from '../copy.js';
import { useNow } from '../now.js';

/** Thrown when a price would render without complete provenance. Spec §11: provenance on every price. */
export class MissingProvenanceError extends Error {
  constructor(detail: string) {
    super(`price rendered without valid provenance: ${detail}`);
    this.name = 'MissingProvenanceError';
  }
}

/** Spec §5.5: the `fixture` provider and the `synthetic` source kind only ever appear together. */
export function provenanceConsistent(p: Pick<ProvenanceT, 'providerId' | 'sourceKind'>): boolean {
  return (p.providerId === 'fixture') === (p.sourceKind === 'synthetic');
}

/**
 * Validates with core's schema, never by presence checks, so a partial object (no fetchedAt,
 * maxAgeHours missing) fails exactly like undefined. Spec §3: nothing is defaulted. Spec §5.5: a
 * `fixture` provider id and a `synthetic` source kind only ever appear together.
 */
export function assertProvenance(p: unknown): ProvenanceT {
  const r = provenanceSchema.safeParse(p);
  if (!r.success)
    throw new MissingProvenanceError(r.error.issues.map((i) => i.path.join('.') || '(root)').join(', '));
  if (!provenanceConsistent(r.data)) {
    throw new MissingProvenanceError(`provider ${r.data.providerId} with source ${r.data.sourceKind}`);
  }
  return r.data;
}

/** Source kinds that only ever carry calendar prices (spec §2): they always get the calendar marker. */
const CALENDAR_SOURCES: ReadonlySet<SourceKind> = new Set(['authorised-cached', 'scraped-aggregate']);

/** True for a price the caller marks as calendar basis or whose source kind only carries calendar prices. */
export function isCalendarPrice(p: ProvenanceT, calendar: boolean): boolean {
  return calendar || CALENDAR_SOURCES.has(p.sourceKind);
}

export interface ProvenanceProps {
  /** Validated here: anything that is not a complete provenance throws MissingProvenanceError. */
  provenance: unknown;
  /** Calendar-basis price: dashed outline and "constraints not checked" (spec §11). Implied by a calendar source kind. */
  calendar: boolean;
  destination?: string | undefined;
  destinationNote?: string | null | undefined;
  /** False only beside the wide Results table's columns, whose Provider column already names the provider (ruling on UI-14). */
  showProvider?: boolean;
  /** Headers show the full age form visibly (spec §3, §11); rows show the compact form with the full one as title. */
  fullAge?: boolean;
}

/** Spec §11 provenance block, visible without hover. */
export function Provenance({
  provenance,
  calendar,
  destination,
  destinationNote,
  showProvider = true,
  fullAge = false,
}: ProvenanceProps) {
  const now = useNow();
  const p = assertProvenance(provenance);
  const age = effectiveAge(p, now);
  const isCalendar = isCalendarPrice(p, calendar);
  return (
    <span
      data-testid="provenance"
      className={`inline-flex flex-wrap items-center gap-1 text-xs text-slate-700 ${isCalendar ? 'rounded border border-dashed border-slate-500 px-1' : ''}`}
    >
      {showProvider ? (
        <span className="rounded bg-slate-200 px-1 font-medium text-slate-900">
          {COPY.provider[p.providerId]}
        </span>
      ) : null}
      <span>{sourceLabel(p)}</span>
      <span data-testid="point-of-sale">{pointOfSaleLabel(p)}</span>
      {fullAge ? (
        <span>{formatAgeFull(age)}</span>
      ) : (
        <span title={formatAgeFull(age)}>{formatAgeCompact(age)}</span>
      )}
      {isCalendar ? <span className="font-medium">{COPY.constraintsNotChecked}</span> : null}
      {destination !== undefined ? <span>{destination}</span> : null}
      {destinationNote ? <span className="italic">{destinationNote}</span> : null}
    </span>
  );
}

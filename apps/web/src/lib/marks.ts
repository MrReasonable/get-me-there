/**
 * The decision-54 marks a view figure may carry, read once for PriceCell: `notSeenInLatest` on a verified-basis minimum
 * (the latest search no longer returned it) and `superseded` on a calendar-basis price (a newer parent execution found
 * its cell empty or no_data). A figure without the field carries no such mark.
 */
export interface FigureMarks {
  notSeenInLatestHours: number | 'unknown' | null;
  superseded: boolean;
}

export function figureMarks(p: {
  notSeenInLatest?: { ageHours: number | 'unknown' } | null;
  superseded?: boolean;
}): FigureMarks {
  return { notSeenInLatestHours: p.notSeenInLatest?.ageHours ?? null, superseded: p.superseded === true };
}

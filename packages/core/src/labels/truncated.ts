/**
 * Decision 30, 37: the label on a price from a discovery tile the pagination cap stopped before its last page. The
 * engine writes it leading the priced cell outcome's `last_error`; WP8 maps an outcome whose `last_error` starts with
 * it to `truncated: true` (decision 36), which the UI renders with this text.
 */
export const TRUNCATED_NOTE = 'cheapest of the rows read';

/** True when an outcome's `last_error` carries the truncation label: the one reader check (decision 47). */
export function isTruncated(reason: string | null): boolean {
  return reason?.startsWith(TRUNCATED_NOTE) ?? false;
}

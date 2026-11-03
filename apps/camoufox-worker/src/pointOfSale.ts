/**
 * Point of sale (spec §2 Labels: "the ISO country of the page's stated location, through a dated table, or 'unknown'
 * when the page states none; it is stored as stated, so a page that ignored `gl` never passes for the requested
 * market"; prov-004). The table holds only names a recording has shown (dated 2026-10-18: the feasibility load's
 * footer "Location·United Kingdom"); United States is the worked example's other market. Re-dated 2026-11-03: a live
 * flights page separated the label from the place with a zero-width space ("Location\u200bUnited Kingdom"), so any
 * invisible format character may sit in the separator.
 */
export const POINT_OF_SALE_DATED = '2026-11-03';
export const LOCATIONS: Readonly<Record<string, string>> = {
  'United Kingdom': 'GB',
  'United States': 'US',
};

/** "Location·United Kingdom" → "GB"; an unlisted or missing location → "unknown". */
export function pointOfSaleOf(locationName: string | null): string {
  if (locationName === null) return 'unknown';
  const place = locationName.replace(/^Location[\s\p{Cf}]*[·:]?[\s\p{Cf}]*/u, '').trim();
  return LOCATIONS[place] ?? 'unknown';
}

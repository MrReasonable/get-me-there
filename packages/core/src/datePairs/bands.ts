/**
 * Folded stay bands (spec §11 "Folded bands"): the overview draws at most twelve stay-length columns per day, so a
 * wider stay range folds into bands of equal width (the last one shorter when the range does not divide evenly).
 */

/** The most stay columns a day of the overview draws. */
export const MAX_NIGHT_BANDS = 12;

/** A band of stay lengths, both ends inclusive. */
export interface NightsBand {
  from: number;
  to: number;
}

/**
 * The bands of a stay range: one per night up to twelve nights, else `ceil(n / 12)` nights wide, in order, covering
 * `[minNights, maxNights]` exactly. Throws `RangeError` on a range that is not whole nights from 0 up.
 */
export function foldNights(minNights: number, maxNights: number): NightsBand[] {
  if (!Number.isInteger(minNights) || !Number.isInteger(maxNights) || minNights < 0 || maxNights < minNights)
    throw new RangeError(`foldNights: ${minNights}–${maxNights} is not a stay range`);
  const n = maxNights - minNights + 1;
  // why: up to twelve lengths this is 1, one band per night
  const width = Math.ceil(n / MAX_NIGHT_BANDS);
  const bands: NightsBand[] = [];
  for (let from = minNights; from <= maxNights; from += width)
    bands.push({ from, to: Math.min(from + width - 1, maxNights) });
  return bands;
}

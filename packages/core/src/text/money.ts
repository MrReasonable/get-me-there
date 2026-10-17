/**
 * Integer pence as pounds for every operator-facing string (core reasons, WP9 cells, WP11 email):
 * `41200` → `£412`, `123456` → `£1,234.56`, `5` → `£0.05`. en-GB grouping with a comma every three
 * digits, built without Intl so no host ICU can change it. Spec §6.3: no float ever holds money,
 * so a non-integer or negative input is a caller bug and throws RangeError.
 */
export function formatPence(pence: number): string {
  if (!Number.isSafeInteger(pence) || pence < 0)
    throw new RangeError(`pence must be a non-negative integer: ${pence}`);
  const pounds = groupThousands(Math.floor(pence / 100));
  const rest = pence % 100;
  return rest === 0 ? `£${pounds}` : `£${pounds}.${String(rest).padStart(2, '0')}`;
}

/**
 * en-GB digit grouping of a non-negative integer, a comma every three digits (13104 → "13,104"), without Intl so no
 * host ICU can change it: the one grouping money and counts share (ca-010).
 */
export function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

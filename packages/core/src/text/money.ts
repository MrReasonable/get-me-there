/**
 * Integer pence as pounds for every operator-facing string (core reasons, WP9 cells, WP11 email):
 * `41200` → `£412`, `123456` → `£1,234.56`, `5` → `£0.05`. en-GB grouping with a comma every three
 * digits, built without Intl so no host ICU can change it. Spec §6.3: no float ever holds money,
 * so a non-integer or negative input is a caller bug and throws RangeError.
 */
export function formatPence(pence: number): string {
  if (!Number.isSafeInteger(pence) || pence < 0)
    throw new RangeError(`pence must be a non-negative integer: ${pence}`);
  const pounds = String(Math.floor(pence / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rest = pence % 100;
  return rest === 0 ? `£${pounds}` : `£${pounds}.${String(rest).padStart(2, '0')}`;
}

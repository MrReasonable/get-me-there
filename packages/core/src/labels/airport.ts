/**
 * An airport named in words, one rule for the web and the Status report. The airports table's name loses a trailing
 * "Airport" ("London Heathrow Airport" reads "London Heathrow"); a label also drops the city's name in front
 * ("Heathrow"), and is the code when the table does not know the airport.
 */
const TRAILING = /\s+(international\s+)?airport$/i;

/** The airport's own name without a trailing "Airport"; the city stays (some airports are named after a nearby town). */
export function airportShortName(name: string): string {
  return name.replace(TRAILING, '').trim() || name;
}

/**
 * "Heathrow", "Newark Liberty": the short name without its city in front, or the code when the table has no row or the
 * name is blank (the airports response allows an empty name).
 */
export function airportLabel(code: string, row: { name: string; city: string } | null | undefined): string {
  if (row === null || row === undefined) return code;
  const short = airportShortName(row.name).trim();
  const label = short.startsWith(`${row.city} `) ? short.slice(row.city.length + 1).trim() : short;
  return label === '' ? code : label;
}

/** "Heathrow (LHR)" when the table names the airport, else the code alone ("QQA"). */
export function airportWithCode(
  code: string,
  row: { name: string; city: string } | null | undefined,
): string {
  const label = airportLabel(code, row);
  return label === code ? code : `${label} (${code})`;
}

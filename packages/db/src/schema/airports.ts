import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Spec §7 `airports`: mwgg/Airports (MIT) with `metro` from the vendored, attributed metro list, and `kind` and
 * `scheduled` from OurAirports (public domain), NULL for an airport OurAirports does not list.
 */
export const airports = sqliteTable(
  'airports',
  {
    iata: text('iata').primaryKey(),
    icao: text('icao'),
    name: text('name').notNull(),
    city: text('city').notNull(),
    country: text('country').notNull(),
    tz: text('tz').notNull(),
    lat: real('lat').notNull(),
    lon: real('lon').notNull(),
    metro: text('metro'),
    kind: text('kind'),
    scheduled: integer('scheduled'),
    source: text('source').notNull(),
    datasetVersion: text('dataset_version').notNull(),
  },
  (t) => [
    check('airports_iata_ck', sql.raw("iata GLOB '[A-Z][A-Z][A-Z]'")),
    check('airports_metro_ck', sql.raw("metro IS NULL OR metro GLOB '[A-Z][A-Z][A-Z]'")),
    check('airports_country_ck', sql.raw("country GLOB '[A-Z][A-Z]'")),
    check('airports_tz_ck', sql.raw('length(tz) > 0')),
    check('airports_kind_ck', sql.raw("kind IS NULL OR kind IN ('large', 'medium', 'small', 'other')")),
    check('airports_scheduled_ck', sql.raw('scheduled IS NULL OR scheduled IN (0, 1)')),
    index('airports_metro_idx').on(t.metro),
  ],
);

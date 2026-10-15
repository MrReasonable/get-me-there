import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { isBool, isInteger, isIsoTimestamp, isNullOrInteger } from './checks.js';

/** Spec §7 `itineraries` (with `layovers_json`): cabin-independent flights, identity by hash (spec §6.4). Insert-or-ignore. */
export const itineraries = sqliteTable(
  'itineraries',
  {
    hash: text('hash').primaryKey(),
    kind: text('kind').notNull().default('flight'),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    departureDate: text('departure_date').notNull(),
    returnDate: text('return_date').notNull(),
    nights: integer('nights').notNull(),
    outboundMinutes: integer('outbound_minutes'),
    inboundMinutes: integer('inbound_minutes'),
    stopsOut: integer('stops_out').notNull(),
    stopsIn: integer('stops_in').notNull(),
    airportChange: integer('airport_change'),
    carriersJson: text('carriers_json').notNull(),
    layoversJson: text('layovers_json').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
  },
  () => [
    check('itineraries_nights_ck', isInteger('nights')),
    check('itineraries_stops_out_ck', isInteger('stops_out')),
    check('itineraries_stops_in_ck', isInteger('stops_in')),
    check('itineraries_out_min_ck', isNullOrInteger('outbound_minutes')),
    check('itineraries_in_min_ck', isNullOrInteger('inbound_minutes')),
    check('itineraries_airport_change_ck', isBool('airport_change', true)),
    check('itineraries_first_seen_ck', isIsoTimestamp('first_seen_at')),
  ],
);

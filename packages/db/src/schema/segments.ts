import { check, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { isInteger, isIsoTimestamp, isNullOrInteger, isOneOf } from './checks.js';
import { itineraries } from './itineraries.js';

/** Spec §7 `segments`: no cabin (segments belong to the cabin-independent itinerary). */
export const segments = sqliteTable(
  'segments',
  {
    itineraryHash: text('itinerary_hash')
      .notNull()
      .references(() => itineraries.hash),
    direction: text('direction').notNull(),
    position: integer('position').notNull(),
    mode: text('mode').notNull().default('air'),
    marketingCarrier: text('marketing_carrier').notNull(),
    operatingCarrier: text('operating_carrier'),
    flightNumber: integer('flight_number').notNull(),
    fromIata: text('from_iata').notNull(),
    toIata: text('to_iata').notNull(),
    departLocal: text('depart_local').notNull(),
    arriveLocal: text('arrive_local').notNull(),
    departUtc: text('depart_utc'),
    arriveUtc: text('arrive_utc'),
    durationMinutes: integer('duration_minutes'),
    aircraft: text('aircraft'),
  },
  (t) => [
    primaryKey({ columns: [t.itineraryHash, t.direction, t.position] }),
    check('segments_direction_ck', isOneOf('direction', ['outbound', 'inbound'])),
    check('segments_position_ck', isInteger('position')),
    check('segments_flight_number_ck', isInteger('flight_number')),
    check('segments_duration_ck', isNullOrInteger('duration_minutes')),
    check('segments_depart_utc_ck', isIsoTimestamp('depart_utc', true)),
    check('segments_arrive_utc_ck', isIsoTimestamp('arrive_utc', true)),
  ],
);

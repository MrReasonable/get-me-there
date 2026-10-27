-- why: plan-a-search (spec §7, revision 51): OurAirports' type and scheduled-service facts per airport, for ranking and
-- filtering the airport search. Additive and nullable: a row OurAirports does not list keeps NULL in both, read as
-- "unknown" (ranked with the rest, never hidden). Hand-written as two ADD COLUMNs instead of drizzle-kit's table
-- rebuild, whose copy selected the new columns from the old table; the snapshot is drizzle-kit 0.31's. Do not regenerate.
ALTER TABLE `airports` ADD `kind` text CONSTRAINT `airports_kind_ck` CHECK(kind IS NULL OR kind IN ('large', 'medium', 'small', 'other'));--> statement-breakpoint
ALTER TABLE `airports` ADD `scheduled` integer CONSTRAINT `airports_scheduled_ck` CHECK(scheduled IS NULL OR scheduled IN (0, 1));

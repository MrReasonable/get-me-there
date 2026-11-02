-- why: The return leg (spec revision 56 §2, §5.3, §7): a flight list stores its return read (the limits the selection
-- used, the status and rule, whether no further outbound within the limits remained untried) and the booking read of
-- its shown pairing in columns of its own, NULL on every existing row and on a list read without a return phase; the
-- attempts, their returns and the booking's offers are rows of three new tables that go with their list. The ledger's
-- provider_requests gains page_count (camoufox only: the pages a row stands for, NULL on every existing row, which
-- counts 1). Hand-written and additive only: every column is an ADD COLUMN instead of drizzle-kit's flight_lists and
-- provider_requests rebuilds (no row is copied, so none can change), each CHECK a named constraint, the coupling CHECKs
-- on the last ADD of their group (SQLite tests an added CHECK against the existing rows, all NULL here); the tables
-- are drizzle-kit's own statements; the snapshot is drizzle-kit 0.31's. Do not regenerate.
ALTER TABLE `flight_lists` ADD `return_status` text CONSTRAINT "flight_lists_return_status_ck" CHECK(return_status IS NULL OR return_status IN ('read', 'no-outbound', 'skipped', 'select-failed', 'not-settled', 'unrecognised', 'not-verified')) CONSTRAINT "flight_lists_return_read_ck" CHECK(return_status IS NULL OR status = 'read');--> statement-breakpoint
ALTER TABLE `flight_lists` ADD `return_rule` text CONSTRAINT "flight_lists_return_rule_ck" CHECK(return_rule IS NULL OR (length(return_rule) <= 80 AND return_rule GLOB '[a-z]*' AND return_rule NOT GLOB '*[^a-z0-9:-]*')) CONSTRAINT "flight_lists_return_rule_status_ck" CHECK(return_rule IS NULL OR (return_status IS NOT NULL AND return_status IN ('read', 'skipped', 'select-failed', 'not-settled', 'unrecognised')));--> statement-breakpoint
ALTER TABLE `flight_lists` ADD `return_limits_json` text CONSTRAINT "flight_lists_return_limits_ck" CHECK(return_limits_json IS NULL OR (json_valid(return_limits_json) AND json_type(return_limits_json) = 'object'));--> statement-breakpoint
ALTER TABLE `flight_lists` ADD `return_tried_all` integer CONSTRAINT "flight_lists_return_tried_all_ck" CHECK(return_tried_all IS NULL OR return_tried_all IN (0, 1)) CONSTRAINT "flight_lists_return_coupled_ck" CHECK((return_status IS NULL) = (return_limits_json IS NULL) AND (return_status IS NULL) = (return_tried_all IS NULL));--> statement-breakpoint
ALTER TABLE `flight_lists` ADD `booking_status` text CONSTRAINT "flight_lists_booking_status_ck" CHECK(booking_status IS NULL OR booking_status IN ('read', 'no-pairing', 'skipped', 'select-failed', 'not-settled', 'unrecognised', 'expand-failed', 'not-verified')) CONSTRAINT "flight_lists_booking_return_ck" CHECK(booking_status IS NULL OR return_status IS NOT NULL);--> statement-breakpoint
ALTER TABLE `flight_lists` ADD `booking_rule` text CONSTRAINT "flight_lists_booking_rule_ck" CHECK(booking_rule IS NULL OR (length(booking_rule) <= 80 AND booking_rule GLOB '[a-z]*' AND booking_rule NOT GLOB '*[^a-z0-9:-]*'));--> statement-breakpoint
ALTER TABLE `flight_lists` ADD `booking_attempt` integer CONSTRAINT "flight_lists_booking_attempt_ck" CHECK(booking_attempt IS NULL OR (typeof(booking_attempt) = 'integer' AND booking_attempt >= 0));--> statement-breakpoint
ALTER TABLE `flight_lists` ADD `booking_return_position` integer CONSTRAINT "flight_lists_booking_return_position_ck" CHECK(booking_return_position IS NULL OR (typeof(booking_return_position) = 'integer' AND booking_return_position >= 0));--> statement-breakpoint
ALTER TABLE `flight_lists` ADD `booking_expanded` integer CONSTRAINT "flight_lists_booking_expanded_ck" CHECK(booking_expanded IS NULL OR booking_expanded IN (0, 1));--> statement-breakpoint
ALTER TABLE `flight_lists` ADD `booking_more_control` integer CONSTRAINT "flight_lists_booking_more_control_ck" CHECK(booking_more_control IS NULL OR booking_more_control IN (0, 1));--> statement-breakpoint
ALTER TABLE `flight_lists` ADD `booking_grouped` integer CONSTRAINT "flight_lists_booking_grouped_ck" CHECK(booking_grouped IS NULL OR (typeof(booking_grouped) = 'integer' AND booking_grouped >= 0));--> statement-breakpoint
ALTER TABLE `flight_lists` ADD `booking_unparsed` integer CONSTRAINT "flight_lists_booking_unparsed_ck" CHECK(booking_unparsed IS NULL OR (typeof(booking_unparsed) = 'integer' AND booking_unparsed >= 0));--> statement-breakpoint
ALTER TABLE `flight_lists` ADD `booking_non_gbp` integer CONSTRAINT "flight_lists_booking_non_gbp_ck" CHECK(booking_non_gbp IS NULL OR (typeof(booking_non_gbp) = 'integer' AND booking_non_gbp >= 0));--> statement-breakpoint
ALTER TABLE `flight_lists` ADD `booking_offers_stated` integer CONSTRAINT "flight_lists_booking_offers_stated_ck" CHECK(booking_offers_stated IS NULL OR (typeof(booking_offers_stated) = 'integer' AND booking_offers_stated >= 0)) CONSTRAINT "flight_lists_booking_coupled_ck" CHECK((booking_status IS NULL) = (booking_expanded IS NULL));--> statement-breakpoint
ALTER TABLE `provider_requests` ADD `page_count` integer CONSTRAINT "provider_requests_page_count_ck" CHECK(page_count IS NULL OR (provider_id = 'camoufox' AND typeof(page_count) = 'integer' AND page_count >= 0));--> statement-breakpoint
CREATE TABLE `flight_list_attempts` (
	`list_id` integer NOT NULL,
	`attempt` integer NOT NULL,
	`outbound_position` integer NOT NULL,
	`outbound_fits` integer NOT NULL,
	`listed` text NOT NULL,
	`more_listed` integer NOT NULL,
	`options_unparsed` integer NOT NULL,
	`options_other_cell` integer NOT NULL,
	`results_stated` integer,
	PRIMARY KEY(`list_id`, `attempt`),
	FOREIGN KEY (`list_id`) REFERENCES `flight_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "flight_list_attempts_attempt_ck" CHECK(attempt IN (0, 1)),
	CONSTRAINT "flight_list_attempts_outbound_position_ck" CHECK(typeof(outbound_position) = 'integer' AND outbound_position >= 0),
	CONSTRAINT "flight_list_attempts_outbound_fits_ck" CHECK(outbound_fits IN (0, 1)),
	CONSTRAINT "flight_list_attempts_listed_ck" CHECK(listed IN ('returns', 'none-for-cell')),
	CONSTRAINT "flight_list_attempts_more_listed_ck" CHECK(more_listed IN (0, 1)),
	CONSTRAINT "flight_list_attempts_options_unparsed_ck" CHECK(typeof(options_unparsed) = 'integer' AND options_unparsed >= 0),
	CONSTRAINT "flight_list_attempts_options_other_cell_ck" CHECK(typeof(options_other_cell) = 'integer' AND options_other_cell >= 0),
	CONSTRAINT "flight_list_attempts_results_stated_ck" CHECK(results_stated IS NULL OR (typeof(results_stated) = 'integer' AND results_stated >= 0))
);--> statement-breakpoint
CREATE TABLE `flight_list_returns` (
	`list_id` integer NOT NULL,
	`attempt` integer NOT NULL,
	`position` integer NOT NULL,
	`departs_local` text NOT NULL,
	`arrives_local` text NOT NULL,
	`arrives_day_offset` integer NOT NULL,
	`duration_minutes` integer NOT NULL,
	`stops` integer NOT NULL,
	`carriers_json` text NOT NULL,
	`operated_by` text,
	`from_pence` integer NOT NULL,
	PRIMARY KEY(`list_id`, `attempt`, `position`),
	FOREIGN KEY (`list_id`,`attempt`) REFERENCES `flight_list_attempts`(`list_id`,`attempt`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "flight_list_returns_position_ck" CHECK(typeof(position) = 'integer' AND position >= 0),
	CONSTRAINT "flight_list_returns_departs_ck" CHECK(departs_local GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "flight_list_returns_arrives_ck" CHECK(arrives_local GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "flight_list_returns_offset_ck" CHECK(typeof(arrives_day_offset) = 'integer' AND arrives_day_offset BETWEEN -1 AND 3),
	CONSTRAINT "flight_list_returns_duration_ck" CHECK(typeof(duration_minutes) = 'integer' AND duration_minutes > 0),
	CONSTRAINT "flight_list_returns_stops_ck" CHECK(typeof(stops) = 'integer' AND stops >= 0),
	CONSTRAINT "flight_list_returns_carriers_ck" CHECK(json_valid(carriers_json) AND json_type(carriers_json) = 'array'),
	CONSTRAINT "flight_list_returns_from_ck" CHECK(typeof(from_pence) = 'integer' AND from_pence > 0)
);--> statement-breakpoint
CREATE TABLE `flight_list_offers` (
	`list_id` integer NOT NULL,
	`position` integer NOT NULL,
	`seller` text NOT NULL,
	`fare` text,
	`price_pence` integer NOT NULL,
	PRIMARY KEY(`list_id`, `position`),
	FOREIGN KEY (`list_id`) REFERENCES `flight_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "flight_list_offers_position_ck" CHECK(typeof(position) = 'integer' AND position >= 0),
	CONSTRAINT "flight_list_offers_seller_ck" CHECK(length(seller) BETWEEN 1 AND 80),
	CONSTRAINT "flight_list_offers_fare_ck" CHECK(fare IS NULL OR length(fare) BETWEEN 1 AND 80),
	CONSTRAINT "flight_list_offers_price_ck" CHECK(typeof(price_pence) = 'integer' AND price_pence > 0)
);

-- why: Search now (spec revision 55 §7, §8.1): every stop stores its cause, and the browser worker's flight lists are
-- kept per date pair. search_executions gains stop_cause_json (the run's StopCause; NULL on a row stopped before this
-- migration, which reads "No reason was recorded for this run.") and flight_lists_json (the run's flight-list plan),
-- both NULL on every existing row; flight_lists holds one read or failed page per row and flight_list_flights its
-- flights. Hand-written: the two columns are ADD COLUMNs instead of drizzle-kit's search_executions rebuild (no row is
-- copied, so none can change); the tables are drizzle-kit's own statements; the snapshot is drizzle-kit 0.31's. Do not
-- regenerate.
ALTER TABLE `search_executions` ADD `stop_cause_json` text CONSTRAINT "search_executions_stop_cause_ck" CHECK(stop_cause_json IS NULL OR (json_valid(stop_cause_json) AND json_type(stop_cause_json) = 'object'));--> statement-breakpoint
ALTER TABLE `search_executions` ADD `flight_lists_json` text CONSTRAINT "search_executions_flight_lists_ck" CHECK(flight_lists_json IS NULL OR (json_valid(flight_lists_json) AND json_type(flight_lists_json) = 'object'));--> statement-breakpoint
CREATE TABLE `flight_lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`definition_id` text NOT NULL,
	`execution_id` text,
	`provider_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`cabin` text NOT NULL,
	`origin` text NOT NULL,
	`destination` text NOT NULL,
	`departure_date` text NOT NULL,
	`return_date` text NOT NULL,
	`fetched_at` text NOT NULL,
	`point_of_sale` text NOT NULL,
	`currency_native` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`listed` text,
	`min_minor` integer,
	`tab_minor` integer,
	`cheapest_view` text,
	`options_unparsed` integer NOT NULL,
	`options_other_cell` integer NOT NULL,
	`results_stated` integer,
	FOREIGN KEY (`definition_id`) REFERENCES `search_definitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`execution_id`) REFERENCES `search_executions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "flight_lists_provider_ck" CHECK(provider_id = 'camoufox'),
	CONSTRAINT "flight_lists_kind_ck" CHECK(source_kind = 'scraped-self'),
	CONSTRAINT "flight_lists_cabin_ck" CHECK(cabin = 'economy'),
	CONSTRAINT "flight_lists_origin_ck" CHECK(origin GLOB '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "flight_lists_destination_ck" CHECK(destination GLOB '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "flight_lists_departure_ck" CHECK(departure_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "flight_lists_return_ck" CHECK(return_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "flight_lists_fetched_ck" CHECK(fetched_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "flight_lists_pos_ck" CHECK(point_of_sale = 'unknown' OR point_of_sale GLOB '[A-Z][A-Z]'),
	CONSTRAINT "flight_lists_currency_ck" CHECK(currency_native = 'GBP'),
	CONSTRAINT "flight_lists_status_ck" CHECK(status IN ('read', 'failed')),
	CONSTRAINT "flight_lists_reason_ck" CHECK(reason IS NULL OR reason IN ('auth', 'rate-limit', 'quota', 'upstream', 'parse', 'network', 'limiter-timeout', 'blocked', 'provider-unavailable', 'captcha', 'unusual-traffic', 'signed-in', 'consent-unhandled', 'sign-in', 'off-allowlist', 'unrecognised', 'settings-differ', 'grid-unverified', 'counts-unreadable', 'no-airport-names', 'none-for-cell', 'unparsed', 'monthly-cap', 'execution-cap', 'free-call-cap', 'outside-browser-window', 'fatal', 'aborted')),
	CONSTRAINT "flight_lists_listed_ck" CHECK(listed IS NULL OR listed IN ('flights', 'no-flights', 'none-for-cell')),
	CONSTRAINT "flight_lists_min_ck" CHECK(min_minor IS NULL OR (typeof(min_minor) = 'integer' AND min_minor > 0)),
	CONSTRAINT "flight_lists_tab_ck" CHECK(tab_minor IS NULL OR (typeof(tab_minor) = 'integer' AND tab_minor > 0)),
	CONSTRAINT "flight_lists_view_ck" CHECK(cheapest_view IS NULL OR cheapest_view IN ('cheapest', 'best-fallback')),
	CONSTRAINT "flight_lists_unparsed_ck" CHECK(typeof(options_unparsed) = 'integer' AND options_unparsed >= 0),
	CONSTRAINT "flight_lists_other_cell_ck" CHECK(typeof(options_other_cell) = 'integer' AND options_other_cell >= 0),
	CONSTRAINT "flight_lists_stated_ck" CHECK(results_stated IS NULL OR (typeof(results_stated) = 'integer' AND results_stated >= 0)),
	CONSTRAINT "flight_lists_failed_reason_ck" CHECK((status = 'failed') = (reason IS NOT NULL)),
	CONSTRAINT "flight_lists_read_listed_ck" CHECK((status = 'read') = (listed IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX `flight_lists_cell_idx` ON `flight_lists` (`definition_id`,`origin`,`destination`,`departure_date`,`return_date`,`cabin`,`point_of_sale`,"fetched_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX `flight_lists_execution_idx` ON `flight_lists` (`execution_id`);--> statement-breakpoint
CREATE TABLE `flight_list_flights` (
	`list_id` integer NOT NULL,
	`position` integer NOT NULL,
	`departs_local` text NOT NULL,
	`arrives_local` text NOT NULL,
	`arrives_day_offset` integer NOT NULL,
	`duration_minutes` integer NOT NULL,
	`stops` integer NOT NULL,
	`carriers_json` text NOT NULL,
	`operated_by` text,
	`price_pence` integer NOT NULL,
	PRIMARY KEY(`list_id`, `position`),
	FOREIGN KEY (`list_id`) REFERENCES `flight_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "flight_list_flights_position_ck" CHECK(typeof(position) = 'integer' AND position >= 0),
	CONSTRAINT "flight_list_flights_departs_ck" CHECK(departs_local GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "flight_list_flights_arrives_ck" CHECK(arrives_local GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "flight_list_flights_offset_ck" CHECK(typeof(arrives_day_offset) = 'integer' AND arrives_day_offset BETWEEN 0 AND 3),
	CONSTRAINT "flight_list_flights_duration_ck" CHECK(typeof(duration_minutes) = 'integer' AND duration_minutes > 0),
	CONSTRAINT "flight_list_flights_stops_ck" CHECK(typeof(stops) = 'integer' AND stops >= 0),
	CONSTRAINT "flight_list_flights_carriers_ck" CHECK(json_valid(carriers_json) AND json_type(carriers_json) = 'array'),
	CONSTRAINT "flight_list_flights_price_ck" CHECK(typeof(price_pence) = 'integer' AND price_pence > 0)
);

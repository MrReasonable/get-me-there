-- why: Settings plan ruling 4: the settings the Settings page owns, one row per name under its env name, the value as
-- .env holds it ('' = unset). Additive only: one new table, no row of another is touched; no CHECK on the name (the
-- repository validates names, so a later name needs no rebuild). The statement is drizzle-kit's own.
CREATE TABLE `settings` (
	`name` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "settings_updated_at_ck" CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
);

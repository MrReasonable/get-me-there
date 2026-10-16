-- why: hand-written (decision 37). drizzle-kit 0.31 generates a table rebuild for this change whose INSERT … SELECT reads
-- confirmed_calls from the old table, which has none, and a rebuild drops a table other tables reference, inside the
-- migrator's transaction where PRAGMA foreign_keys has no effect. One ADD COLUMN with a column CHECK is the same schema;
-- the generated meta/0001_snapshot.json records it as a table-level check, which is equivalent. Do not regenerate.
ALTER TABLE `search_definitions` ADD `confirmed_calls` integer CONSTRAINT "search_definitions_confirmed_calls_ck" CHECK(confirmed_calls IS NULL OR (typeof(confirmed_calls) = 'integer' AND confirmed_calls >= 0));

// Barrel for @gmt/db. Every public export of the package is re-exported from here;
// consumers never deep-import. Extended by WP3.
export { type Db, openDatabase } from './client.js';
export { applyMigrations, pendingMigrations } from './migrate.js';

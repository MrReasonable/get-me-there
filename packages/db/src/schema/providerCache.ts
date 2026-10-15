import { sql } from 'drizzle-orm';
import { check, index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { isIsoTimestamp } from './checks.js';

/**
 * Spec §7 `provider_cache`. Keys are http-kit's credential-free sha256 hex (spec §5.3), enforced here too.
 * why: `provider_id` is kept because spec §7 (rev 12) lists it, though nothing writes or reads it yet: the
 * `ResponseCache` port's `set` carries no provider, so every row stores NULL and maintenance expires by `expires_at`
 * alone. Dropping it is a spec change, raised with the spec owner (arch-M6), not made here.
 */
export const providerCache = sqliteTable(
  'provider_cache',
  {
    key: text('key').primaryKey(),
    providerId: text('provider_id'),
    bodyJson: text('body_json').notNull(),
    storedAt: text('stored_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [
    index('provider_cache_expires_idx').on(t.expiresAt),
    check('provider_cache_key_ck', sql.raw("length(key) = 64 AND key NOT GLOB '*[^0-9a-f]*'")),
    check('provider_cache_stored_ck', isIsoTimestamp('stored_at')),
    check('provider_cache_expires_ck', isIsoTimestamp('expires_at')),
  ],
);

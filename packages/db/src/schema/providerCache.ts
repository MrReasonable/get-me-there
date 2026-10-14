import { sql } from 'drizzle-orm';
import { check, index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { isIsoTimestamp } from './checks.js';

/**
 * Spec §7 `provider_cache` (`provider_id` NULL: the `ResponseCache` port's `set` carries no provider). Keys are
 * http-kit's credential-free sha256 hex (spec §5.3), enforced here too.
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

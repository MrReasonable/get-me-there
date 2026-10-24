import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import type { Db } from '../client.js';

/** Spec §7 `app_meta`: facts about this database itself (migration 0007). */
export class MetaRepo {
  constructor(private readonly db: Db) {}

  /**
   * Decision 82 (review S5, T10): this database's app-instance id, kept with the canonical path of the file it was
   * made in, which this repository works out itself (`realpathSync.native`: symlinks followed and, on a
   * case-insensitive volume, the letter case the file system holds), whatever form the opener passed. Opened at that
   * path again (a restart, a container recreate, whose path is always /data/…) it is the same id; opened at another
   * path (a copied or moved file, a backup restored into a second app) it is a second ledger, so a new random id
   * replaces it. The read and the write run in one immediate transaction, so two openers at once wait their turn
   * (busy_timeout) instead of failing to upgrade a read.
   */
  appInstanceId(): string {
    const databasePath = this.db.raw.name === ':memory:' ? ':memory:' : realpathSync.native(this.db.raw.name);
    return this.db.immediateTransaction(() => {
      const read = (key: string) =>
        this.db.raw.prepare<[string], { value: string }>('SELECT value FROM app_meta WHERE key = ?').get(key)
          ?.value ?? null;
      const id = read('app_instance_id');
      if (id !== null && read('app_instance_path') === databasePath) return id;
      const fresh = randomUUID();
      const put = this.db.raw.prepare(
        'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      );
      put.run('app_instance_id', fresh);
      put.run('app_instance_path', databasePath);
      return fresh;
    });
  }
}

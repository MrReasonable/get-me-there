import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Db } from '../client.js';

/** Spec §7 `app_meta`: facts about this database itself (migration 0007). */
export class MetaRepo {
  constructor(private readonly db: Db) {}

  /**
   * Decision 82 (review S5): this database's app-instance id, kept with the absolute path of the file it was made in
   * (the config realpaths DATABASE_PATH before opening it). Opened at that path again (a restart, a container recreate,
   * whose path is always /data/…) it is the same id; opened at another path (a copied or moved file, a backup restored
   * into a second app) it is a second ledger, so a new random id replaces it. Both rows are written in one transaction.
   */
  appInstanceId(): string {
    const databasePath = this.db.raw.name === ':memory:' ? ':memory:' : resolve(this.db.raw.name);
    return this.db.transaction(() => {
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

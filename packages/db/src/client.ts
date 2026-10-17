import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';

/** Synchronous-only callback: better-sqlite3 commits at the first `await`, so a Promise return is a type error. Spec §7. */
type SyncFn<T> = () => T extends Promise<unknown> ? never : T;

export interface Db {
  raw: Database.Database;
  drizzle: BetterSQLite3Database;
  /** Runs `fn` in one deferred transaction. */
  transaction<T>(fn: SyncFn<T>): T;
  /** Same, with BEGIN IMMEDIATE: the write lock is taken before `fn` runs (BudgetGuard.reserve, AppLock). */
  immediateTransaction<T>(fn: SyncFn<T>): T;
  /** `wal_checkpoint(TRUNCATE)` on a file db (spec §7 shutdown); nothing for ':memory:'. The pragma's one home. */
  checkpoint(): void;
  /** Checkpoints, then closes. */
  close(): void;
}

/** Opens the one SQLite file (or ':memory:') with the spec §7 settings: WAL, busy_timeout 5000, foreign keys on. */
export function openDatabase(path: string): Db {
  const raw = new Database(path);
  // why: WAL lets the SPA read while the engine writes; a memory db has no journal file.
  if (path !== ':memory:') raw.pragma('journal_mode = WAL');
  raw.pragma('busy_timeout = 5000');
  raw.pragma('foreign_keys = ON');
  const orm = drizzle(raw);
  const guarded = <T>(fn: SyncFn<T>) =>
    raw.transaction(() => {
      const result = fn();
      if (result instanceof Promise) throw new TypeError('transaction callbacks must be synchronous');
      return result;
    });
  const checkpoint = () => {
    if (path !== ':memory:') raw.pragma('wal_checkpoint(TRUNCATE)');
  };
  return {
    raw,
    drizzle: orm,
    transaction: (fn) => guarded(fn)(),
    immediateTransaction: (fn) => guarded(fn).immediate(),
    checkpoint,
    close: () => {
      checkpoint();
      raw.close();
    },
  };
}

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

/** The file system refused WAL (dm-003): the database would run in rollback-journal mode, against spec §7. */
export class WalUnavailableError extends Error {
  constructor(path: string, mode: unknown) {
    super(
      `${path}: SQLite kept journal_mode ${String(mode)} instead of WAL; the data directory's file system does not support WAL (spec §7; docs/setup.md sections 6 and 10)`,
    );
    this.name = 'WalUnavailableError';
  }
}

/**
 * dm-003: `PRAGMA journal_mode = WAL` answers the mode in force and, on a file system that cannot hold WAL (some bind
 * mounts), quietly keeps the old one. Anything but 'wal' is refused, so boot stops instead of running without it.
 */
export function assertWalMode(mode: unknown, path: string): void {
  if (mode !== 'wal') throw new WalUnavailableError(path, mode);
}

/** Opens the one SQLite file (or ':memory:') with the spec §7 settings: WAL, busy_timeout 5000, foreign keys on. */
export function openDatabase(path: string): Db {
  const raw = new Database(path);
  // why: WAL lets the SPA read while the engine writes; a memory db has no journal file.
  if (path !== ':memory:') {
    const mode = raw.pragma('journal_mode = WAL', { simple: true });
    try {
      assertWalMode(mode, path);
    } catch (e) {
      raw.close();
      throw e;
    }
  }
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

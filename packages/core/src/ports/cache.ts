import type { IsoDateTime } from '../types/ids.js';

/** Spec §5.3: keys are credential-free hashes; bodies arrive scrubbed; a hit returns the original storedAt. */
export interface ResponseCache {
  get(key: string): { body: unknown; storedAt: IsoDateTime } | undefined;
  set(key: string, body: unknown, ttlSeconds: number, storedAt: IsoDateTime): void;
}

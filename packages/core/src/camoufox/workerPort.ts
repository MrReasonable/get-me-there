/**
 * The worker's port (spec §12; ca-b1-008): CAMOUFOX_WORKER_PORT in worker.env, 8090 when unset. The worker listens on
 * it and `gmt setup` writes the app's CAMOUFOX_WORKER_URL from it, through this one rule, so the two cannot disagree.
 */
export const WORKER_PORT = { default: 8090, min: 1024, max: 65535 } as const;

/** The port a worker.env value names: the default when unset or empty, null when it is not a port in range. */
export function workerPortOf(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return WORKER_PORT.default;
  const v = Number(raw);
  return /^\d+$/.test(raw) && v >= WORKER_PORT.min && v <= WORKER_PORT.max ? v : null;
}

/** The app's address for a worker on this machine at `port` (loopback only). */
export const workerUrlFor = (port: number): string => `http://127.0.0.1:${port}`;

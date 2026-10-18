import { WORKER_KEY_HEADER, workerStatusSchema } from '@gmt/core';
import { loadWorkerConfig } from './config.js';
import { type Entry, type EntryContext, EX_UNAVAILABLE } from './run.js';
import { BIND_HOST } from './server.js';

/**
 * `status` (brief Task 14.5; SEC-R2-005): reads the key from worker.env through run.ts and calls the worker's own
 * `/v1/status`, so the key never reaches a command line or a shell history. Prints the live status, never the key.
 */
export async function status(ctx: EntryContext, fetchFn: typeof fetch = fetch): Promise<number> {
  const cfg = loadWorkerConfig(ctx.env);
  let res: Response;
  try {
    res = await fetchFn(`http://${BIND_HOST}:${cfg.port}/v1/status`, {
      headers: { [WORKER_KEY_HEADER]: cfg.key.reveal() },
    });
  } catch {
    ctx.err(`the camoufox worker is not reachable on ${BIND_HOST}:${cfg.port}`);
    return EX_UNAVAILABLE;
  }
  if (res.status !== 200) {
    ctx.err(`the camoufox worker answered HTTP ${res.status}`);
    return EX_UNAVAILABLE;
  }
  const body = workerStatusSchema.safeParse(await res.json());
  if (!body.success) {
    ctx.err('the camoufox worker answered a status this build cannot read');
    return EX_UNAVAILABLE;
  }
  ctx.out(JSON.stringify(body.data, null, 2));
  return 0;
}

export const entry: Entry = async (ctx) => status(ctx);

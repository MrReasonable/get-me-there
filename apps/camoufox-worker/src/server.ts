import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  ANSWER_STATUS,
  GOOGLE_CONTACTED_HEADER,
  type Logger,
  type PageRequest,
  pageRequestSchema,
  type Secret,
  WORKER_KEY_HEADER,
  type WorkerStatus,
} from '@gmt/core';
import type { PageResult } from './session.js';

/**
 * The worker's HTTP API (brief §6; spec §2; decision 69; SEC-012, TS-15). It binds 127.0.0.1 only (Docker Desktop
 * forwards host.docker.internal to it). Every request carries `x-gmt-worker-key`, compared in constant time over
 * equal-length buffers; a missing, mismatched or wrong-length key is 401 with no body. Every answer states
 * `x-gmt-google-contacted`. One JSON log line per request: route, status, answer kind, duration; never the key, a
 * cookie or a page name.
 */
export const BIND_HOST = '127.0.0.1';
export const MAX_BODY_BYTES = 4096;

export interface ServerDeps {
  key: Secret;
  log: Logger;
  page(req: PageRequest): Promise<PageResult>;
  status(): Promise<WorkerStatus>;
  /** Called after an answer whose result was fatal (the cool-down store failed): main exits 70. */
  onFatal(): void;
  now(): number;
}

function keyOk(given: string | string[] | undefined, key: Secret): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key.reveal());
  // why: timingSafeEqual needs equal lengths; a length mismatch is refused without comparing contents.
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  contacted: boolean,
  extra: Record<string, string> = {},
): void {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    [GOOGLE_CONTACTED_HEADER]: contacted ? '1' : '0',
    ...extra,
  });
  res.end(text);
}

/** Reads at most MAX_BODY_BYTES; null when the body is larger. */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) over = true;
      else chunks.push(c);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createWorkerServer(d: ServerDeps): Server {
  return createServer((req, res) => {
    const started = d.now();
    const route = `${req.method ?? '?'} ${(req.url ?? '').split('?')[0]}`;
    const done = (status: number, kind: string): void =>
      d.log.info({ route, status, kind, durationMs: d.now() - started }, 'worker request');
    // why: fix round 1 (arch M8): once the page handler ran, a 500 cannot say Google was not contacted
    let pageCalled = false;
    void (async () => {
      if (!keyOk(req.headers[WORKER_KEY_HEADER], d.key)) {
        send(res, 401, undefined, false);
        return done(401, 'unauthorised');
      }
      if (route === 'GET /v1/status') {
        send(res, 200, await d.status(), false);
        return done(200, 'status');
      }
      if (route !== 'POST /v1/page') {
        send(res, 404, undefined, false);
        return done(404, 'not-found');
      }
      const type = req.headers['content-type'] ?? '';
      const body = await readBody(req);
      let parsed: unknown;
      try {
        parsed = body === null || !/^application\/json\b/.test(type) ? undefined : JSON.parse(body);
      } catch {
        parsed = undefined;
      }
      const r = pageRequestSchema.safeParse(parsed);
      if (!r.success) {
        send(res, 400, { kind: 'bad-request' }, false);
        return done(400, 'bad-request');
      }
      pageCalled = true;
      const result = await d.page(r.data);
      // why: spec §2 rev 34: a grid page asking for more scrolls than this worker allows is refused, nothing loaded
      if (result.rejected === true) {
        send(res, 400, { kind: 'bad-request' }, false);
        return done(400, 'bad-request');
      }
      const status = ANSWER_STATUS[result.answer.kind];
      const extra: Record<string, string> =
        result.answer.kind === 'spacing' ? { 'retry-after': String(result.answer.retryAfterSeconds) } : {};
      send(res, status, result.answer, result.googleContacted, extra);
      done(status, result.answer.kind);
      if (result.fatal === true) d.onFatal();
    })().catch((e: unknown) => {
      d.log.error({ route, error: e instanceof Error ? e.name : 'unknown' }, 'worker request failed');
      if (!res.headersSent) send(res, 500, undefined, pageCalled);
      else res.end();
    });
  });
}

/** The listening port of a TCP server, narrowed with a guard (never a cast). */
export function portOf(server: Server): number {
  const a = server.address();
  if (a === null || typeof a === 'string') throw new Error('server not listening on TCP');
  return a.port;
}

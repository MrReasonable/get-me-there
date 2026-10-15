import { type Dirent, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { HttpResponse, http } from 'msw/http';
import { loadRecordedFixture, type RecordedFixture } from '../http/recorder.js';
import { stripUrl } from '../http/scrub.js';
import { byPair } from '../util.js';
import type { RequestHandler } from './handlers.js';

const isRecording = (name: string): boolean =>
  name.endsWith('.json') && !name.endsWith('.raw.json') && !name.startsWith('params-');

/** Match key: method, origin, path and the sorted, decoded query pairs (placeholders as recorded). */
function keyOf(method: string, url: URL): string {
  return `${method.toUpperCase()} ${url.origin}${url.pathname} ${JSON.stringify([...url.searchParams.entries()].sort(byPair))}`;
}

function walk(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : isRecording(e.name) ? [join(dir, e.name)] : [],
  );
}

/** Loaded recordings in recordedAt order, file path breaking ties (pie-010). */
function loadAll(root: string, dir: string): Array<{ path: string; f: RecordedFixture }> {
  return walk(dir)
    .map((path) => ({ path, f: loadRecordedFixture(path, root) }))
    .sort((a, b) =>
      a.f.recordedAt !== b.f.recordedAt
        ? a.f.recordedAt < b.f.recordedAt
          ? -1
          : 1
        : a.path < b.path
          ? -1
          : a.path > b.path
            ? 1
            : 0,
    );
}

/** One provider endpoint's recordings, in recordedAt order. `endpointPath` uses the recorder's layout (/ → _). */
export function loadRecorded(root: string, providerId: string, endpointPath: string): RecordedFixture[] {
  return loadAll(root, join(root, providerId, endpointPath.replaceAll('/', '_'))).map(({ f }) => f);
}

/**
 * msw handlers that answer requests from the recorded tree (plan http-kit block): match on method, origin, path and
 * query (placeholders as recorded); serve the recorded status and body; identical requests from one session take the
 * recordings in recordedAt order, then the last. A match key served by more than one recording session is refused at
 * construction unless `opts.session` picks one (prov-r2-001). An unmatched request is pushed to `misses()` and answered
 * with a network error, so nothing ever reaches the real network (arch-r2-001); consumers assert misses() is empty.
 */
export function replayHandlers(
  recordedRoot: string,
  opts: { session?: string } = {},
): { handlers: RequestHandler[]; misses(): string[] } {
  const all = loadAll(recordedRoot, recordedRoot).filter(
    ({ f }) => opts.session === undefined || f.session === opts.session,
  );
  const byKey = new Map<string, RecordedFixture[]>();
  for (const { f } of all) {
    const k = keyOf(f.request.method, new URL(f.request.url));
    byKey.set(k, [...(byKey.get(k) ?? []), f]);
  }
  for (const [k, list] of byKey) {
    const sessions = new Set(list.map((f) => f.session));
    if (sessions.size > 1)
      throw new Error(
        `replay: ${k} is recorded by sessions ${[...sessions].join(' and ')}; pass opts.session to choose one`,
      );
  }
  const served = new Map<string, number>();
  const misses: string[] = [];
  const origins = [...new Set(all.map(({ f }) => new URL(f.request.url).origin))].sort();
  const handlers = origins.map((origin) =>
    http.all(`${origin}/*`, ({ request }) => {
      const url = new URL(request.url);
      const k = keyOf(request.method, url);
      const list = byKey.get(k);
      const n = served.get(k) ?? 0;
      const f = list?.[Math.min(n, list.length - 1)];
      if (f === undefined) {
        // why: names only, never values — a value could be a token or a key. msw 3 passes an unanswered request
        // through to the network, so a miss is answered here with a network error instead (arch-r2-001).
        misses.push(
          `${request.method} ${stripUrl(request.url)} ?${[...new Set(url.searchParams.keys())].sort().join('&')}`,
        );
        return HttpResponse.error();
      }
      served.set(k, n + 1);
      // why: a malformed vendor body was recorded as text; replay it byte for byte so the parse path is exercised.
      const text = typeof f.body === 'string' ? f.body : JSON.stringify(f.body);
      return new HttpResponse(text, {
        status: f.status,
        headers: { 'content-type': 'application/json', ...f.responseHeaders },
      });
    }),
  );
  return { handlers, misses: () => [...misses] };
}

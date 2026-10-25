// A stand-in for the camoufox worker's `GET /v1/status` on the Mac's loopback, installed as global fetch (the api's tests
// never import msw). Anything else the app asks for fails the test: the Status report may read nothing but the worker.
import { vi } from 'vitest';

export const WORKER_URL = 'http://127.0.0.1:8090';
export const WORKER_KEY = 'test-camoufox-worker-key-0123456789abcdef';
export const WORKER_ENV = {
  CAMOUFOX_ENABLED: 'true',
  CAMOUFOX_WORKER_URL: WORKER_URL,
  CAMOUFOX_WORKER_KEY: WORKER_KEY,
};

const SHARED = {
  CAMOUFOX_COOLDOWN_HOURS: '48',
  CAMOUFOX_PAGE_TIMEOUT_SECONDS: '90',
  CAMOUFOX_MODE: 'list',
  CAMOUFOX_GRID_SCROLL_CAP: '30',
  CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: '5',
  CAMOUFOX_MONTHLY_PAGE_CAP: '1500',
  CAMOUFOX_MONTHLY_SCROLL_CAP: '6000',
  CAMOUFOX_BILLING_DAY: '1',
  POINT_OF_SALE: 'GB',
};

/** A status body the app's schema accepts; `over` replaces or adds fields. */
export function workerBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    coolingDownUntil: null,
    cooldownCause: null,
    signedInRefusal: false,
    lastPageAt: null,
    busySince: null,
    versions: { selectors: '2026-10-01', grammar: '2026-10-01', camoufoxJs: '0.11.5', binary: 'b1' },
    flags: { FORM_VERIFIED: true },
    accountCookie: { found: false, names: [], checkedAt: '2026-10-14T08:59:00.000Z' },
    socsCapturedAt: '2026-10-01T10:00:00.000Z',
    socsStable: true,
    cooldownHours: 48,
    pageTimeoutSeconds: 90,
    sharedSettings: SHARED,
    consent: { kind: 'socs', expiresAt: '2027-10-01T10:00:00.000Z', boundedBy: 'capture' },
    monthly: {
      windowStart: '2026-10-01T00:00:00.000Z',
      windowEnd: '2026-11-01T00:00:00.000Z',
      pages: 12,
      scrolls: 30,
      readable: true,
    },
    appInstances: { windowStart: '2026-10-01T00:00:00.000Z', count: 1 },
    ...over,
  };
}

export interface FetchLog {
  /** Every URL the app asked fetch for. */
  urls: string[];
}

/**
 * Installs the stand-in. `answer` gives the worker's response (default: a good status); any other URL throws. The
 * stub honours the request's abort signal, as the platform's fetch does.
 */
export function stubWorker(
  answer: (signal: AbortSignal | null) => Promise<Response> | Response = () => Response.json(workerBody()),
): FetchLog {
  const log: FetchLog = { urls: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      log.urls.push(url.href);
      if (url.origin !== WORKER_URL || url.pathname !== '/v1/status')
        throw new Error(`the status report reached for ${url.origin}${url.pathname}`);
      const signal = init?.signal ?? (input instanceof Request ? input.signal : null);
      return new Promise<Response>((resolve, reject) => {
        const onAbort = () => reject(new DOMException('aborted', 'AbortError'));
        if (signal?.aborted === true) return onAbort();
        signal?.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(answer(signal)).then(resolve, reject);
      });
    }),
  );
  return log;
}

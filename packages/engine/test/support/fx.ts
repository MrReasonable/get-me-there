import { vi } from 'vitest';

/**
 * Answers requests to api.frankfurter.dev on global fetch with `respond`; every other host goes on to the fetch the
 * network guards installed, so a stray request still fails the test. why: decision 20 — only @gmt/providers/testing
 * imports msw, and http-kit's in-process seam is fixture.local only; the setup file unstubs globals after each test.
 */
export function stubFrankfurter(respond: (url: URL) => Response | Promise<Response>): { urls: string[] } {
  const urls: string[] = [];
  const guarded = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== 'api.frankfurter.dev') return guarded(input, init);
    urls.push(url.toString());
    return respond(url);
  });
  return { urls };
}

/** A frankfurter `latest` body: units of each currency per 1 GBP. */
export function frankfurterBody(rates: Record<string, number>, date = '2026-10-14'): Record<string, unknown> {
  return { amount: 1, base: 'GBP', date, rates };
}

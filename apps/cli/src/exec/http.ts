import { Agent, fetch } from 'undici';
import type { Http } from '../deps.js';

/**
 * The connections every request to the app and the worker goes through, with the HTTP client's own header and body
 * timeouts off. why: those timeouts (undici's, 300 s each by default, which Node's global fetch applies) would end a
 * request the app legitimately answers later, such as the smoke's one grid page with many scrolls, before the
 * request's stated bound; each request carries that bound itself (`timeoutMs`), and it is the only one. undici's own
 * fetch takes this pool: Node's global fetch speaks the dispatcher contract of the undici bundled with that Node.
 */
export const CLIENT_TIMEOUTS_OFF = { headersTimeout: 0, bodyTimeout: 0 } as const;
const OWN_BOUND_ONLY = new Agent(CLIENT_TIMEOUTS_OFF);

/** Requests to this machine's app only; the Authorization header is never logged or echoed. */
export const systemHttp: Http = async (r) => {
  try {
    const res = await fetch(r.url, {
      method: r.method,
      headers: r.headers,
      body: r.body ?? null,
      signal: AbortSignal.timeout(r.timeoutMs),
      dispatcher: OWN_BOUND_ONLY,
    });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    return { error: e instanceof Error ? e.name : 'request failed' };
  }
};

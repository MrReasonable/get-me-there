import { Agent, setGlobalDispatcher } from 'undici';

/**
 * The connections global fetch uses in this process, with the HTTP client's own header and body timeouts off. why:
 * those timeouts (undici's, 300 s each by default) would end an attempt that legitimately takes longer, such as a grid
 * page with many scrolls (spec §2: its bound grows with the scroll cap), before the attempt's own bound
 * (`requestTimeoutSeconds`, spec §5.3), which every attempt carries and which is the only one.
 */
export const CLIENT_TIMEOUTS_OFF = { headersTimeout: 0, bodyTimeout: 0 } as const;
const OWN_BOUND_ONLY = new Agent(CLIENT_TIMEOUTS_OFF);

/**
 * Makes OWN_BOUND_ONLY global fetch's dispatcher. why global: http-kit calls globalThis.fetch, which tests stand in
 * for, and a per-request dispatcher must speak the contract of the undici bundled with the running Node; undici's
 * setGlobalDispatcher installs it for every bundled version.
 */
export function useOwnBoundsOnly(): void {
  setGlobalDispatcher(OWN_BOUND_ONLY);
}

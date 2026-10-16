import type { FlightProvider } from '@gmt/core';
import { SEARCHAPI_PARAMS } from '../../../src/searchapi/params.js';
import { searchApiProvider } from '../../../src/searchapi/provider.js';
import { KEY, saKit } from './kit.js';

type Options = Parameters<typeof searchApiProvider>[0];

export function makeProvider(k = saKit(), overrides: Partial<Options> = {}): FlightProvider {
  return searchApiProvider({
    http: k.kit,
    log: k.log,
    clock: k.clock,
    key: KEY,
    costPerCallMicroGbp: 0,
    pointOfSale: 'GB',
    cacheTtlSeconds: 3600,
    paramsAllowlist: SEARCHAPI_PARAMS,
    ...overrides,
  });
}

/** Both capabilities, or a failure: SearchApi always exposes discovery and verification. */
export function capabilities(p: FlightProvider) {
  const { discovery, verification } = p;
  if (discovery === undefined || verification === undefined)
    throw new Error('searchapi exposes both capabilities');
  return { discovery, verification };
}

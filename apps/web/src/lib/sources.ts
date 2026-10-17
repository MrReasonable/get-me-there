import type { ProviderId, SourceKind } from '@gmt/core';
import type { ProvidersResponse } from '../api/types.js';
import { COPY } from '../copy.js';

/**
 * The source in words for a provider's discovery counts, which carry only a providerId: the sourceKind of that
 * provider's discovery capability from GET /api/providers (spec §11 vocabulary). Before the providers response
 * arrives, or for a provider it does not list, the provider's own name stands in; no source kind is assumed.
 */
export function discoverySourceLabel(
  providerId: ProviderId,
  providers: ProvidersResponse | undefined,
): string {
  const capability =
    providers?.providers.find((p) => p.providerId === providerId)?.capabilities.discovery ?? null;
  return capability === null ? COPY.provider[providerId] : COPY.source[capability.sourceKind];
}

/**
 * A series label from the source kinds of the prices it plots (each price carries its own provenance). Normally one
 * kind; if a series mixes kinds every one is named, never only the first.
 */
export function sourceLabelOf(kinds: Iterable<SourceKind>): string {
  return [...new Set(kinds)].map((k) => COPY.source[k]).join(' / ');
}

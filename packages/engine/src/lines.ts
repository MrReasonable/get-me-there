import type { ProviderId, Stage } from '@gmt/core';

/**
 * One (stage, provider) line of an estimate, the unit a budget check blocks (ruling 2, ssr I2): a provider whose
 * discovery is fully reused can still be blocked for verification, and a line that needs no call is never blocked.
 */
export type LineKey = `${Stage}:${ProviderId}`;

export function lineKey(stage: Stage, providerId: ProviderId): LineKey {
  return `${stage}:${providerId}`;
}

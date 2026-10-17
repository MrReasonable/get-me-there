import { type ProviderId, SOURCE_LABELS } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { discoverySourceLabel, sourceLabelOf } from '../../src/lib/sources.js';
import { providersResponse } from '../fixtures.js';

describe('source labels (spec §11 vocabulary; synthetic tagged end to end, spec §5.5)', () => {
  const withFixture = providersResponse({
    providers: [
      ...providersResponse().providers,
      {
        providerId: 'fixture',
        displayName: 'Fixture',
        enabled: true,
        plan: 'synthetic',
        excludedFromSchedule: false,
        notices: [],
        capNote: null,
        capabilities: {
          discovery: { sourceKind: 'synthetic', provenanceNote: 'synthetic', maxAgeHours: 0 },
          verification: null,
        },
        usage: [],
      },
    ],
  });
  it.each<[ProviderId, string]>([
    ['travelpayouts', 'Aviasales cache'],
    ['searchapi', 'Google date grid via SearchApi'],
    ['fixture', SOURCE_LABELS.synthetic],
  ])('discovery counts of %s are labelled "%s" from the providers response', (id, label) => {
    expect(discoverySourceLabel(id, withFixture)).toBe(label);
  });
  it('before the providers response arrives the provider is named, never given a source kind', () => {
    expect(discoverySourceLabel('travelpayouts', undefined)).toBe('Travelpayouts');
  });
  it('a series label names every source kind its prices carry', () => {
    expect(sourceLabelOf(['authorised-cached', 'authorised-cached'])).toBe('Aviasales cache');
    expect(sourceLabelOf(['authorised-cached', 'synthetic'])).toBe(
      `Aviasales cache / ${SOURCE_LABELS.synthetic}`,
    );
  });
});

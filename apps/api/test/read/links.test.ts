// Spec revision 55 §2 (prov-int-017): a camoufox row's search link is the page the browser worker reads, in its
// verified URL form, with `gl` the install's point of sale; it re-validates under the camoufox allowlist.
import { asIsoDate, SEARCH_LINK_LABEL } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { safeSearchLink } from '../../src/read/links.js';
import { exampleDefinitionInput, JFK, LHR, SMALL_WINDOW } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe('safeSearchLink camoufox (spec rev 55 §2)', () => {
  it('links to the worker’s page with gl the point of sale, GB when it is unknown', async () => {
    h = await createHarness();
    const def = h.ports.repos.definitions.create(
      exampleDefinitionInput({ origins: [LHR], destinations: [JFK], window: SMALL_WINDOW }),
    );
    const cell = {
      origin: LHR,
      destination: JFK,
      departureDate: asIsoDate('2027-03-14'),
      returnDate: asIsoDate('2027-03-24'),
    };
    const q = 'q=Flights+from+LHR+to+JFK+on+2027-03-14+returning+2027-03-24&curr=GBP&hl=en-GB';
    expect(safeSearchLink('camoufox', cell, def, null, 'US')).toEqual({
      url: `https://www.google.com/travel/flights?${q}&gl=US`,
      host: 'www.google.com',
      label: SEARCH_LINK_LABEL,
    });
    expect(safeSearchLink('camoufox', cell, def)?.url).toBe(
      `https://www.google.com/travel/flights?${q}&gl=GB`,
    );
  });
});

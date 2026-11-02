import type { ProviderId } from '../types/provenance.js';

/**
 * Spec revision 55 §3 "Main-path words" (design §7): the one table of the sources' names on the main path (the first
 * screen, a search's page, the new-search form, Edit and its More options, the status bar, and every stop sentence).
 * The set-up views and the provenance labels keep §2's names (`PROVIDER_NAMES`, `SOURCE_LABELS`). Lower case where the
 * name is a common noun, so it reads mid-sentence; a sentence that starts with one capitalises its first letter.
 */
export const MAIN_PATH_SOURCE: Readonly<Record<ProviderId, string>> = {
  camoufox: 'the browser worker',
  travelpayouts: 'the Aviasales cache',
  searchapi: 'Google Flights via SearchApi',
  fixture: 'the test source',
};

/** A source's main-path name (spec revision 55 §3), as `MAIN_PATH_SOURCE` gives it. */
export function mainPathSource(id: ProviderId): string {
  return MAIN_PATH_SOURCE[id];
}

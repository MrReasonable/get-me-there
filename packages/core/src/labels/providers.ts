import type { ProviderId } from '../types/provenance.js';

/** The short name of each provider in every card, line and fix of the app, the report and the web: one table. */
export const PROVIDER_NAMES: Readonly<Record<ProviderId, string>> = {
  travelpayouts: 'Travelpayouts',
  searchapi: 'SearchApi',
  camoufox: 'Camoufox',
  fixture: 'Fixture',
};

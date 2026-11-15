import { type DatePairFigure, stopDetailClause } from '@gmt/core';
import { COPY } from '../copy.js';

// Ruling 5 (Trips and Search plan): what a calendar price says of its flights, from the figure's own fields, so the Search
// page's calendar rows and the Trip card's calendar sentences say the same of one read.

/**
 * One line for the figure's flight read: "Flights not read", "Return flights not read", and for a failed list "Flights
 * couldn't be read: <reason>" (the reason as the stop words name it; without one, no colon). Every `PairingRead` has
 * words (the exhaustive record in COPY), and a failed read never says "not read".
 */
export function readStateWords(fig: Pick<DatePairFigure, 'pairingRead' | 'listReason'>): string {
  if (fig.pairingRead === 'list-failed' && fig.listReason !== null)
    return COPY.readState.failed(stopDetailClause(fig.listReason, 'camoufox', true));
  return COPY.readState.words[fig.pairingRead];
}

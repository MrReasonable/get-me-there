import type { FlightLimits } from '@gmt/core';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../api/client.js';
import { type FlightReadRequest, useFlightLists, useFlightRead } from '../api/flights.js';
import type { FlightListsResponse } from '../api/types.js';
import { COPY } from '../copy.js';
import { datesShort, type FlightPair, pairKey } from './flightLines.js';
import { readDoneWords } from './pairing.js';

// Spec rev 55 §8.1 "Reading one date pair's flights", §11 (Ruling 21: moved here from the search page's flights block,
// beside its users, the Search page's "Lower on the calendar" and the Trip page): the flight lists of the dates a page
// shows, the read on demand, and a refused read's words. Nothing here changes a price: a read that lands is read back
// through the page's own read, where its date becomes a trip.

const F = COPY.flights;

/** What the flight-lists request says, by its state: pending, failed, or what it answered (21.7 prov-004). */
export type ListsState = 'loading' | 'failed' | 'available' | 'unavailable';

/** A date pair being read on demand: the press's, or the one the api says it is reading. */
interface Reading {
  key: string;
  pair: FlightReadRequest;
  /** The figure's list id when pressed (null: none), so the newer list is seen when it lands. */
  listId: number | null;
  /** When the press was accepted (ms), or null while the POST is in flight; null too for the api's own reading. */
  acceptedAt: number | null;
}

/** What a page knows of its dates' flights: every asked pair's entry, the answer's facts, and the read controls. */
export interface BoardFlights {
  byKey: ReadonlyMap<string, FlightPair>;
  /** The newest answer's facts (spec rev 55 §10), or null before any answer. */
  meta: Omit<FlightListsResponse, 'pairs'> | null;
  lists: ListsState;
  /** The date pair being read now (the press's or the api's), by key, or null. */
  readingKey: string | null;
  /** What the live region says, by the key it is for: a refused press's words, or that the pressed read ended. */
  said: { key: string; words: string } | null;
  read: (pair: FlightReadRequest) => void;
}

/**
 * Why flight lists cannot be read here, in words (spec rev 55 §11; rulings A33, R-cabin): the economy-only line for a
 * search in another cabin, else the worker's line.
 */
export function unavailableWords(reason: unknown): string {
  return reason === 'cabin' ? F.unavailableCabin : F.unavailable;
}

/** A refused read's words (spec rev 55 §11; finding 5): the api's code and its reason, never its message text. */
export function refusalWords(e: unknown): string {
  if (!(e instanceof ApiError)) return F.readFailed;
  switch (e.code) {
    case 'browser_busy':
      return F.busy;
    case 'not_available':
      return unavailableWords(e.details?.reason);
    case 'outside_space':
      return F.outsideSpace;
    default:
      return F.readFailed;
  }
}

/**
 * Spec rev 55 §11: the flight lists of the dates a page shows, one request per page of `pages`, and the read on
 * demand. While a read is going (pressed here, or the api's `reading`) every page is re-read each POLL_MS; the press
 * clears when the pair's newer list lands (`onLanded` is then called, so the page reads its dates again and the date
 * becomes a trip), or when an answer after the press says nothing is being read (the read ended with no list).
 */
export function useBoardFlights(
  definitionId: string,
  pages: readonly (readonly string[])[],
  limits: FlightLimits,
  onLanded: () => void = () => {},
): BoardFlights {
  const [pressed, setPressed] = useState<Reading | null>(null);
  const [said, setSaid] = useState<{ key: string; words: string } | null>(null);
  const [polling, setPolling] = useState(false);
  const lists = useFlightLists(definitionId, pages, polling);
  const mutation = useFlightRead(definitionId);
  const byKey = useMemo(() => {
    const m = new Map<string, FlightPair>();
    for (const a of lists.answers) for (const p of a.pairs) m.set(pairKey(p), p);
    return m;
  }, [lists.answers]);
  const newest = lists.answers.at(-1) ?? null;
  const apiReading = lists.answers.find((a) => a.reading !== null)?.reading ?? null;
  const readingKey = pressed?.key ?? (apiReading === null ? null : pairKey(apiReading));
  const pressedList = pressed === null ? null : (byKey.get(pressed.key)?.list ?? null);
  // why: final review B-I3: the pressed pair's own readNow, so its live words say what happens next as its note does
  const pressedReadNow = pressed === null ? false : (byKey.get(pressed.key)?.readNow ?? false);
  useEffect(() => setPolling(readingKey !== null), [readingKey]);
  useEffect(() => {
    if (pressed === null || pressed.acceptedAt === null) return;
    // why: the newer list has landed, or an answer read after the press says no read is going (it ended with none)
    const landed = (pressedList?.id ?? null) !== pressed.listId;
    if (!landed && !(lists.fetchedAt > pressed.acceptedAt && apiReading === null)) return;
    const dates = datesShort(pressed.pair.departureDate, pressed.pair.returnDate, F);
    setSaid({
      key: pressed.key,
      // why: spec rev 56 §11: the read's returns in the live region ("…, 2 return flights"), or its status note's words
      words:
        landed && pressedList !== null
          ? readDoneWords(pressedList, dates, COPY, limits, pressedReadNow)
          : F.readNotDone(dates),
    });
    setPressed(null);
    if (landed) onLanded();
  }, [pressed, pressedList, pressedReadNow, lists.fetchedAt, apiReading, limits, onLanded]);
  const meta =
    newest === null
      ? null
      : {
          available: newest.available,
          unavailableReason: newest.unavailableReason,
          refreshHours: newest.refreshHours,
          pagesPlanned: newest.pagesPlanned,
          reading: apiReading,
        };
  // why: 21.7 prov-004: "not available" only when the request succeeded and said flight lists are not read here;
  // pending and failed are their own states
  const listsState: ListsState =
    lists.status === 'loading'
      ? 'loading'
      : lists.status === 'failed'
        ? 'failed'
        : meta?.available === true
          ? 'available'
          : 'unavailable';
  const read = (of: FlightReadRequest) => {
    // why: the request body is exactly the contract's fields (a strict object): the dates, and the airport pair when
    // the row names it (both or neither), never the page's whole row
    const pair: FlightReadRequest =
      of.origin !== undefined && of.destination !== undefined
        ? {
            departureDate: of.departureDate,
            returnDate: of.returnDate,
            origin: of.origin,
            destination: of.destination,
          }
        : { departureDate: of.departureDate, returnDate: of.returnDate };
    const key = pairKey(pair);
    const listId = byKey.get(key)?.list?.id ?? null;
    setSaid(null);
    setPressed({ key, pair, listId, acceptedAt: null });
    mutation.mutate(pair, {
      onSuccess: () => setPressed({ key, pair, listId, acceptedAt: Date.now() }),
      onError: (e) => {
        setPressed(null);
        setSaid({ key, words: refusalWords(e) });
      },
    });
  };
  return { byKey, meta, lists: listsState, readingKey, said, read };
}

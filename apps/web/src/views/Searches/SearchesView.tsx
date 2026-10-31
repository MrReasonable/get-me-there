import { useIsMutating } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCards, useProvidersWatch, useSearchRemoval } from '../../api/queries.js';
import type { SearchCard as Card } from '../../api/types.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { SyntheticBanner } from '../../components/SyntheticBanner.js';
import { COPY } from '../../copy.js';
import { DefinitionForm } from '../Definitions/DefinitionForm.js';
import '../Definitions/definitions.css';
import { RemovedLine } from './RemovedLine.js';
import { SearchCard } from './SearchCard.js';
import './searches.css';

const S = COPY.searchesView;

/** How long "Removed <name>. Undo" stays (spec rev 55 §11): 30 s, through any re-read of the cards. */
export const UNDO_MS = 30_000;

/** A remove or undo in flight (`'pending'`) or failed (its error); a settled one is dropped from the map. */
type Pending = 'pending' | Error;

/** A copy of `m` with `id` set to `value`, or dropped when `value` is null. */
function with_(
  m: ReadonlyMap<string, Pending>,
  id: string,
  value: Pending | null,
): ReadonlyMap<string, Pending> {
  const next = new Map(m);
  if (value === null) next.delete(id);
  else next.set(id, value);
  return next;
}

/** A search removed from this view: where its card was, and whether Undo has put it back (the restore succeeded). */
interface Removed {
  id: string;
  name: string;
  index: number;
  restored: boolean;
}

/** A synthetic or fixture price among the cards: the red banner shows whatever `/providers` says (spec §5.5). */
const hasSyntheticCheapest = (cards: readonly Card[]): boolean =>
  cards.some(
    (c) =>
      c.cheapest !== null &&
      (c.cheapest.provenance.providerId === 'fixture' || c.cheapest.provenance.sourceKind === 'synthetic'),
  );

/**
 * Spec rev 55 §11 "Searches" (`?view=searches`, the first screen and always the landing view): layout B, the operator's
 * searches as the main column and the new-search form beside it on the right; narrower than 900 px the form sits above the
 * list. It reads `GET /definitions/cards` and keeps the served order (while a mutation is pending the order is held and
 * changes only on the next settled read), re-reading at the status bar's poll interval only while a card is pending or
 * running.
 *
 * Remove asks inline on its card; once it succeeds the card is replaced, in its place, by "Removed <name>. Undo" for
 * `UNDO_MS`, kept through any re-read. Undo restores the search and puts its card back where the api's order puts it,
 * with focus on its heading. Until Task 20.5 replaces it, the side column mounts the existing new-search form unchanged
 * (ruling A18).
 */
export function SearchesView() {
  const cards = useCards();
  // why: the shell's /providers read as an observer only (a second active observer on a failed query reads as pending)
  const providers = useProvidersWatch();
  const { remove, restore, refresh } = useSearchRemoval();
  const mutating = useIsMutating() > 0;
  const [removed, setRemoved] = useState<Removed[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  // why: each remove and each undo is tracked by its search's id here, not read from the mutation hook, whose single
  // `variables` and per-`mutate()` callbacks only follow the latest call: two quick removes would lose the first one's line
  const [removals, setRemovals] = useState<ReadonlyMap<string, Pending>>(new Map());
  const [undos, setUndos] = useState<ReadonlyMap<string, Pending>>(new Map());
  const served = cards.data?.cards ?? [];

  // why: the served order is the api's; while a mutation of this view is pending it is held, so a re-read that lands
  // meanwhile cannot move a card under the pointer, and it changes only on the next settled read
  const held = useRef<readonly string[]>([]);
  let ordered: readonly Card[] = served;
  if (mutating) {
    const rank = new Map(held.current.map((id, i) => [id, i]));
    ordered = [...served].sort(
      (a, b) => (rank.get(a.id) ?? held.current.length) - (rank.get(b.id) ?? held.current.length),
    );
  } else held.current = served.map((c) => c.id);

  const servedIds = new Set(served.map((c) => c.id));
  // why: a restored search is dropped from `removed` once the re-read serves it again, so its card and its line never
  // both show and the line never leaves a gap before the card is back
  useEffect(() => {
    setRemoved((r) =>
      r.some((x) => x.restored && servedIds.has(x.id))
        ? r.filter((x) => !(x.restored && servedIds.has(x.id)))
        : r,
    );
  });

  const lineShown = (x: Removed) => !(x.restored && servedIds.has(x.id));
  const hidden = new Set(removed.filter(lineShown).map((x) => x.id));
  const items: Array<{ kind: 'card'; card: Card } | { kind: 'removed'; entry: Removed }> = ordered
    .filter((c) => !hidden.has(c.id))
    .map((card) => ({ kind: 'card', card }));
  for (const entry of [...removed].filter(lineShown).sort((a, b) => a.index - b.index))
    items.splice(Math.min(entry.index, items.length), 0, { kind: 'removed', entry });

  const onFocused = useCallback(() => setFocusId(null), []);

  const removeCard = (card: Card) => {
    const index = items.findIndex((i) => i.kind === 'card' && i.card.id === card.id);
    setRemovals((m) => with_(m, card.id, 'pending'));
    remove.mutateAsync(card.id).then(
      () => {
        setRemovals((m) => with_(m, card.id, null));
        setRemoved((r) => [
          ...r.filter((x) => x.id !== card.id),
          { id: card.id, name: card.name, index, restored: false },
        ]);
        void refresh();
      },
      (e: Error) => setRemovals((m) => with_(m, card.id, e)),
    );
  };
  const undo = (entry: Removed) => {
    setUndos((m) => with_(m, entry.id, 'pending'));
    restore.mutateAsync(entry.id).then(
      () => {
        setUndos((m) => with_(m, entry.id, null));
        setRemoved((r) => r.map((x) => (x.id === entry.id ? { ...x, restored: true } : x)));
        setFocusId(entry.id);
        void refresh();
      },
      (e: Error) => setUndos((m) => with_(m, entry.id, e)),
    );
  };
  const errorOf = (m: ReadonlyMap<string, Pending>, id: string): Error | null => {
    const v = m.get(id);
    return v instanceof Error ? v : null;
  };

  const side = (
    <section aria-label={S.sideHeading} className="searches-side">
      {providers.error ? (
        <LoadError error={providers.error} retry={() => void providers.refetch()} />
      ) : providers.data === undefined ? (
        <Loading />
      ) : (
        <DefinitionForm key="new" existing={null} providers={providers.data} />
      )}
    </section>
  );
  const main = (
    <section aria-label={S.listLabel} className="searches-main">
      {cards.error ? <LoadError error={cards.error} retry={() => void cards.refetch()} /> : null}
      {cards.data === undefined && cards.error === null ? <Loading /> : null}
      {cards.data !== undefined && items.length === 0 ? (
        <p className="plate notice font-semibold">{S.noSearches}</p>
      ) : null}
      {items.length > 0 ? (
        <ul aria-label={S.listLabel} className="searches-list">
          {items.map((item) =>
            item.kind === 'card' ? (
              <SearchCard
                key={item.card.id}
                card={item.card}
                removing={removals.get(item.card.id) === 'pending'}
                removeError={errorOf(removals, item.card.id)}
                onRemove={() => removeCard(item.card)}
                focusHeading={focusId === item.card.id}
                onFocused={onFocused}
              />
            ) : (
              <RemovedLine
                key={`removed-${item.entry.id}`}
                name={item.entry.name}
                undoing={undos.get(item.entry.id) === 'pending'}
                undoError={errorOf(undos, item.entry.id)}
                onUndo={() => undo(item.entry)}
                onExpire={() => setRemoved((r) => r.filter((x) => x.id !== item.entry.id))}
                ms={UNDO_MS}
              />
            ),
          )}
        </ul>
      ) : null}
    </section>
  );
  return (
    <div className="searches-view space-y-5">
      {/* why: the shell already shows the banner when /providers says synthetic (spec §5.5: one banner) */}
      {hasSyntheticCheapest(served) && providers.data?.synthetic !== true ? <SyntheticBanner /> : null}
      <h2 className="h-view">{S.heading}</h2>
      {/* why: one stable tree; below 900 px CSS puts the form above the list (searches.css), so crossing the
      breakpoint never remounts the form or loses its draft */}
      <div className="searches-layout">
        {main}
        {side}
      </div>
    </div>
  );
}

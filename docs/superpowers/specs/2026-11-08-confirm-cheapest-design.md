# Confirm the cheapest flights automatically: design

Written 2026-11-08. Status: folded into the main design spec (`2026-10-14-flight-price-optimiser-design.md`, §6.9, §8.1,
§10, §11) as revision 68; where this document and the main spec differ, the main spec governs. This document was the
brief for that change and the plan that followed it. Choices marked *(my call)* were made by the author, not the
operator; the operator decided the goal, the 5 trips, stopping rule A, the ranking tiers of §5.2 and the wording
"trips with flights read" (2026-11-08, after the plan's review).

## 1. Why

The operator opens the app to find the cheapest trip they would actually book. Today a search's headline prices are
the browser's date-grid prices, and those are not what the trip costs. In the operator's own search on 2026-11-08 the
top row read £565; when that date pair's flights were read, the cheapest round trip within the search's limits was
£634, and Google's list for the same dates said "from £540". One row showed three prices, and the largest is the one
the operator would pay.

The flight-list step that reads real flights (spec §8.1) reads a fixed 10 date pairs, the first 10 of the board's
ranking, and stops. In the same search the last run's 10 were nine trips sharing one outbound date and one more,
while the dates the board showed first kept flight reads three days old. The operator then had to ask for more dates
to be read by hand. They should not have to: checking the prices the app is about to show is part of the search.

## 2. Goals

1. A search finishes with **its 5 cheapest confirmed trips**: date pairs whose outbound and return flights were read
   within the search's limits, each with a real round-trip price.
2. The search decides by itself how far down the calendar to read, using the stopping rule in §4.4 (the operator
   chose rule A on 2026-11-08: stop once more checking stops helping).
3. Every view leads with confirmed trips and their real price; a calendar price is shown as what it is, never as the
   price of a trip.
4. The estimate before a run states the time this adds, from measured read times.

## 3. Non-goals and anti-goals

- **Not in this change:** the first-screen card redesign and the booking link that opens the booking page for the
  exact flights (project 2); settings in the database (project 3); per-search source toggles (project 4); the other
  screens (project 5). This change makes sure the data those need exists and stops the search page misleading.
- **Not a guarantee of the cheapest possible trip.** Rule A can stop before a cheaper trip further down the calendar.
  The page says how many cheaper-looking dates were left unchecked; it never claims "cheapest" for what it did not
  check.
- **Anti-goal:** a run that reads hundreds of pages. Reading every date priced below the 5th confirmed trip could
  take about 50 minutes in the operator's search (473 dates within £100 of the cheapest). Rule A, as defined in §4.4,
  bounds every case, including searches where fewer than 5 trips can ever be confirmed.
- **Anti-goal:** new caps or counters guarding problems we have not seen (the operator's standing rule). The only
  numbers this change adds are the two in §4.4, and it withdraws one (§4.8).

## 4. The rule

### 4.1 Terms

- **Calendar price**: a date-grid price for a date pair (`basis: 'calendar'`). Says nothing about flights, changes or
  journey time.
- **Read**: the flight-list step's read of one date pair (spec §8.1): the outbound list, then the return phase and,
  where the worker's flags allow, the booking read, on one page. Measured from the stored rows of the run of
  2026-11-07 17:12: 10 reads, one at a time, every one with return status `read` and booking status `read`, finishing
  19–29 s apart (about 23 s each). Spec revision 66 (§8.1 and its changelog) and the comment on `FLIGHT_VIEW_SECONDS`
  in `packages/engine/src/estimate.ts` call these "outbound-only" reads; that is wrong and is corrected with this
  change.
- **Confirmed trip** *(my call)*: a date pair whose pairing candidate (spec §6.9 `cheapestPairing`) fits the search's
  current limits (`fits`), was read under them (`underCurrentLimits`) and within the refresh (`fresh`). Its
  **confirmed price** is the cheapest seller offer when the booking read kept complete offers (`offersComplete`), else
  Google's round-trip price for the paired outbound and return; the figure says which of the two it is. A booking read
  that ended transient still confirms the trip at Google's price: sellers are not required. The operator-facing words
  are **"trips with flights read"**, never "confirmed", which the app already uses for its "≠ price not confirmed"
  mark (Ian, 2026-11-08); "confirmed" stays the internal term. A pairing older than the refresh is not confirmed; it is re-read. A
  `verified` figure (an itinerary price from SearchApi's itinerary search) is a confirmed trip at its price; such
  pairs are not in the step's queue, since they were already priced as itineraries.
- **No trip within limits**: a read whose return status is `no-outbound`, or whose pairing has no return within the
  limits. The date pair is checked and has no confirmed price.

`pairingLeads` (spec §6.9) is relaxed to match: a pairing leads its date's figure when it is a confirmed trip, with or
without a seller offer *(my call)*. The `sellers-not-read` and `offers-incomplete` readings stay as detail lines.

### 4.2 What gets checked, in what order

After discovery, the step builds its **queue** from every date pair that has a current calendar price (not superseded,
not missing from the latest search), departs after today (London) and has no fresh `verified` figure, in **calendar price order, cheapest first**, with the board's existing
tie order. There is no fixed count: the stopping rule ends the step. `FLIGHT_LIST_COUNT` (10) stops being the step's
limit and remains only for the outbound-only fallback of §4.6.

A pair whose newest list is reusable (`listReusable`, spec §8.1 Reuse: read with returns under the same limits within
0.9 × the refresh) is **not read again**: its stored list is checked at once *(my call: §4.4)*.

Reads run `CAMOUFOX_PAGES_AT_ONCE` at a time, as now (spec rev 66).

### 4.3 What a check does to the standings

Each finished check either:

- adds a confirmed trip at its confirmed price,
- or marks the pair checked with no trip within limits,
- or leaves the pair **unread** (no confirmed trip, nothing learnt about its flights): a failed read that does not end
  the step, an outbound-only read after returns stopped, a return read that ended transient, or a list reused because
  its last two reads ended transient (`transientStreak` 2).

The **standings** are the confirmed trips, cheapest first. Fresh, current `verified` figures (itinerary prices from
SearchApi) enter the standings by reuse before the queue is walked, since they are confirmed trips too; a stale
verified figure's pair is queued and read like a calendar one *(my call, after the plan's re-review)*. A pair read
recently enough to lead (within the refresh) but too old to reuse (over 0.9 × the refresh) that the step does not
reach counts as checked, not as unchecked.

### 4.4 When the step stops (rule A)

Two constants in `core`:

- `CONFIRM_TARGET = 5`: how many confirmed trips the operator wants.
- `CONFIRM_PATIENCE = 12`: how many reads in a row may fail to improve the standings before the step stops (three
  rounds of 4 pages at once, about 75 s).

A check **improves** the standings when it adds a confirmed trip and either fewer than `CONFIRM_TARGET` trips were
confirmed before it, or its confirmed price is below the `CONFIRM_TARGET`-th confirmed price before it.

**Patience counts reads, not reuse** *(my call)*. A reused pair fills the standings at once, costs no page and
neither spends nor resets patience. Every read that finishes (a page was used) counts: an improving one resets the
count to 0, any other adds 1, including the third bullet of §4.3. So a run that follows a recent one reuses what was
confirmed and spends its patience on dates not yet checked, carrying on where the last run stopped.

The step starts no new read once the last `CONFIRM_PATIENCE` finished reads include no improvement. This holds
whether or not `CONFIRM_TARGET` trips are confirmed *(my call)*: while fewer than 5 are confirmed every new trip
improves, so 12 reads in a row that confirm nothing mean the remaining dates are unlikely to, and the step stops
rather than read the whole calendar.

It also stops when the queue is empty, and for every reason it stops today (cancel, the run's window, an ending
error; the first stop met decides, spec rev 66). Reads in flight when it stops finish and are kept, as now.

Worked example (synthetic, London → New York): the calendar's cheapest pairs are £300, £300, £305, … The first 6
reads confirm £352, £371, £349, £360, £398 and £356; the 5th-cheapest confirmed is now £371. Reads 7–18 confirm nothing
below £371 (they come out between £372 and £420, and two have no trip within limits). After read 18 the last 12 reads
held no improvement, so the step starts no more reads; the 2 still in flight finish. The search shows £349, £352,
£356, £360 and £371.

### 4.5 What is left unchecked

When the step stops, the **unchecked cheaper-looking dates** are the queue's remaining pairs whose calendar price is
below the `CONFIRM_TARGET`-th confirmed price; with fewer than 5 confirmed, every remaining pair in the queue
*(my call)*. The count is stored with the run (§7) and shown (§5). No row is written for a pair the step did not start: when an
ending error stops the step, the pairs not started stay as they were (their last real trip, if any, keeps leading) and
count as unchecked, never as "couldn't be read".

### 4.6 When returns cannot be read

- **Off from the start** (`RETURN_SELECT_VERIFIED` off on that platform): no read can confirm a trip. The step reads
  as it does today (the first `FLIGHT_LIST_COUNT` pairs, outbound only), rule A does not apply, and the page says
  trips could not be confirmed on this machine and why.
- **Lost part-way** (`returnsStopped` set during the step) *(my call)*: the step starts no new read; reads in flight
  finish. Its stop is recorded as `returns-stopped`, and the page says so with the trips confirmed before it.

### 4.7 Suspend and resume *(my call)*

A step that **finished** (a stop of §4.4, `returns-stopped`, or an ending error) reads nothing on a later pass of the
same run, such as a resume after a verification pause. A step that was **interrupted** (the run's window, a
cool-down, a crash) resumes by rebuilding the queue from the calendar as it then stands: this run's own stored lists
count as reads already made (not as reuse), lists from other runs as reuse, `returnsStopped` and `bookingStopped`
carry over, the counts are cumulative, and only patience starts again at 0. A resumed pass that cannot enter the step
because the window has passed records `ended: 'window'`.

### 4.8 The per-run flight allowance is withdrawn *(my call)*

Each run's snapshot carries `flightListPages` (10 pairs × 2 pages = 20), checked by the step itself before each read
and by the budget guard, and returns are planned only when it holds 2 pages for every candidate. With an open-ended
queue that allowance would stop the step after 10 pairs and never plan returns. It is withdrawn everywhere it is
checked or reported, as the browser's other per-run caps were (spec revisions 64 and 65): rule A bounds the step. The
snapshot field stays only as the step's on-switch, and the usage report stops calling it a cap. A resumed run whose
stored snapshot still carries the figure ignores it.

## 5. What the operator sees

These are the changes this project makes to the existing screens; the card's new layout is project 2's.

1. **One price per row.** A row with flights read shows its price with what kind it is ("seller's price", "Google's
   price, sellers not read", or "Google's price, not every seller read") and when it was read ("read 6 h ago"), the outbound and return times, and journey time
   and changes each way. A row with only a calendar price shows it in the secondary style as "calendar £565" with what
   is known of its flights: "flights not checked" only when its flights were never read, otherwise the existing
   reading ("no trip within your limits", "flights couldn't be read", "read under other limits", "return flights not
   read"). Google's list "from" figure moves into the expanded detail.
2. **Ranking in three tiers** (Ian, 2026-11-08): trips whose flights were read within the refresh (and fresh verified
   figures), by price; then older trips with flights read that still lead their date under the 2026-11-06 ruling (and
   stale verified figures), by price, each showing its age; then calendar-only prices. The shared ranking
   (`rankDatePairs`) does this, so the best-dates table, "best per departure week", the card's cheapest price and the
   engine's own ranking move together. A labelled break separates the trips from the "not checked yet" rows. The
   overview grid keeps shading by each date's own price; its outline marks the date pairs with flights read, and its
   legend says so.
3. **Rows closed by default.** Each row shows one line; its full flight detail opens on demand with a keyboard-operable
   button. (Today every row opens, and 10 rows make a 14,000 px page.)
4. **Ranks in order.** Within a tie the rows are numbered in the order shown; rank 2 never sits above rank 1.
5. **How checking ended**, under the table, in one line *(my call: wording)*. "Checked N dates" counts reads and reuses
   together; ", K couldn't be read" is added when any read was unread (§4.3):
   - rule A, 5 or more trips: "Checked 18 dates; 7 trips with flights read. 31 dates look cheaper on the calendar but
     weren't checked."
   - queue empty: "Checked every date with a calendar price; 5 trips with flights read."
   - rule A, fewer than 5: "Checked 12 dates; 2 trips with flights read: the other dates' flights didn't fit your limits
     or couldn't be read. 288 dates weren't checked."
   - stopped otherwise: "Stopped checking flights after 9 dates because the browser's time ran out (… return flights
     couldn't be read / … the search was cancelled / the stop's own existing words for an ending page or a cap); 3 trips
     with flights read. 120 dates weren't checked." With 5 or more trips the count is the cheaper-looking dates: "31
     dates that look cheaper on the calendar weren't checked."
   - returns off on this machine: "Trips couldn't be checked on this machine: it can't read return flights."
   - the browser had not reported what it can read when the step planned: "Trips couldn't be checked this run: the
     browser hadn't yet said what it can read."
   - while the step runs: "Checking flights: 9 dates so far; 3 trips with flights read."
   - a run from before this change, or one that never reached the step: no line.
6. **The card** shows the first-ranked trip's price and dates instead of the calendar price, with its price kind and
   age, until project 2 replaces the card.

## 6. The estimate

The flight line of the estimate (spec §8.1, revision 66) changes from "the first 10 pairs" to a range:

- **Typical:** 25 reads (`CONFIRM_TARGET + CONFIRM_PATIENCE` plus 8 for the improving reads expected beyond the
  target), less the reusable pairs among the queue's first 25, but never fewer than `CONFIRM_PATIENCE` (or the
  unreused queue, if smaller), since reuse does not spend patience.
- **At most:** every unreused pair in the queue.

The same queue feeds the estimate before a run, the estimate with the worker's flags unread (returns assumed, as the
never-understates rule requires), and the remaining estimate of a resumed run (a rebuilt queue; 0 for a finished
step).

Each read is costed at **25 s** (the measured 19–29 s of §4.1, rounded up), in waves of `CAMOUFOX_PAGES_AT_ONCE`.
The current per-pair figures (230 s typical, 285 s at most with the booking read) came from page counts and are about
nine times the measured time; they are replaced. With 4 pages at once the typical line reads "then about 3 minutes
checking flights, longer if prices are close together".

## 7. Data

- The step's stored summary (`flight_lists_json`) holds: the mode (`confirm`, or `outbound-only` when returns are off),
  reads made, pairs reused, trips confirmed, reads left unread (§4.3), the unchecked cheaper-looking count of §4.5,
  and which stop ended the step (`patience` for rule A, `queue-empty`, `returns-stopped`, or the existing stops). An
  absent summary means a run stored before this change. No migration: the column is JSON read through its schema.
- Confirmed trips are not stored separately: they are derived from the newest flight lists, as the board does now.

## 8. Testing

- `core`: the improvement test and the stop decision as pure functions; the worked example of §4.4; ties; a
  `no-outbound` read; a transient read counting against patience; reuse neither spending nor resetting patience; the
  stop with fewer than 5 confirmed; the relaxed `pairingLeads`; the shared ranking with confirmed trips first.
- `engine`: the step on a fake worker finishing reads in a different order from the queue (4 at once), proving
  patience counts reads in finishing order; a second run that reuses the first run's confirmed trips and reads on from
  where it stopped; the stop with reads in flight; returns lost part-way; the outbound-only fallback; resume; the
  allowance no longer stopping the step; the stored summary.
- `api`/`web`: confirmed first in every view that reads the ranking, one price per row, rows closed by default, rank
  order within a tie, each stop line.
- The estimate's new figures, and the corrected wording of revision 66's measurement.

## 9. Left to the builder

- Where the improvement counter lives (the step's loop or a small pure reducer in `core`), as long as §8's pure tests
  can reach it.
- The exact layout of a closed row and of the stop line, within §5 and the existing design system.
- How the existing tie order is applied within the queue.

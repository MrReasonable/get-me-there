# Search now: asking for a trip in one step

**Design, 2026-10-31.** Agreed with Ian in conversation on 2026-10-31 (the first screen and the
finished-search page were agreed from mockups). It is folded into the main spec
(`2026-10-14-flight-price-optimiser-design.md`) as **revision 55** by the first task of the work, so the
main spec stays the single source of truth; until then, where the two disagree, this design describes the
intended change. Revision 55 is now written, and where it and this design differ, revision 55 holds (a few lines
below are brought into line with it: the stop wording, the key's direction, the flight-list reuse threshold and the
flight pages' duration). Section references (§n, l.n) are to the main spec at revision 54. Revised 2026-10-31 after the
core roster's review of the work brief (`docs/briefs/wp20-search-now.md`): the paragraphs marked *Ian ruled
2026-10-31* carry his three rulings, and those marked *ruled on the brief's review* the orchestrator's rulings on the
review's open items; everything else is as agreed in the conversation, *my call* marks included.

## 1. Why

The operator could not do the one thing the app is for: "fly from X to Y, leave in this window, stay this
many nights, go and find it now". A first-time walkthrough on a copy of the app (Birmingham to Frankfurt,
leave 10 January to 31 March, 10 to 14 nights) took 18 clicks and three presses of Run now:

- the new search was **disabled**, and the only fix was a schedule tick box that also signed it up for weekly
  runs (a disabled definition refuses manual runs too: `packages/engine/src/start.ts:249`);
- **no price source was ticked**, so the second press failed with "the definition names no provider"
  (camoufox is never pre-ticked: `apps/api/src/defaults.ts`);
- the form has **no Search button**: "Show estimate", then "Create and confirm about 0 calls (hard stop 0)",
  then "Created. Scheduled runs use…", and nothing starts;
- **Run now runs the header's selected search**, not the one being edited (`def=` vs `edit=`);
- the run **paused with no reason** ("Paused: paused: error" beside "0 error"): the all-sources-disabled path
  sets no `error_text`, and the cells sit in the skipped bucket;
- **hour-old prices read STALE** (age 1 h + assumed vendor age 24 h = 25 h, against a threshold built from the
  *currently registered* provider's declared age, 0 in list mode, rather than the row's own);
- there is **no way to book**, ten rows tie at the same price with nothing to choose between them, and the
  page speaks in "cells", "discovery", "definition", "hard stop", "verdict class" and "retry factor".

Ian, on what he wants to see on opening the app: "my saved searches and a form to kick off a new search". On
choosing between date pairs: "Flight time, changes, time of departure", and prices alone are "good enough if
that's all we can get", with flight details "with whatever we can get".

## 2. Goals, non-goals, anti-goals

**Goals**

1. From the first screen, a search for a new trip starts with From, To, a departure window, a stay range and
   one **Search now** press. Nothing else must be decided.
2. A search's page says what is happening in plain words: searching (how far, how long left), finished (when,
   how much was priced), or stopped (why, and the one thing to do).
3. A finished search leads with the cheapest date pairs **and, where the browser worker could read them, their
   flights** (departure time, flight time, changes, airline), states ties once, and links every date pair to
   Google Flights to book.
4. Main-path words are plain: no "cells", "discovery", "definition", "hard stop", "verdict class", "tile",
   "retry factor" or variable names.

**Non-goals**

- Booking, or any price the app has not read.
- Changing what the engine searches or how it pages Google's date grid.
- Removing the set-up views (Providers, Alerts, Status, History) or the budget machinery; they stay, off the
  main path.
- As first designed, the return leg's flight details (§6.3). Superseded: spec revision 56 (WP21) reads the return
  flights of the one or two selected outbounds and the sellers' offers for the shown pairing, and the main spec is
  current; what this document says of an outbound-only read is the first build.

**Anti-goals (a failure even if it works)**

- A price that looks more certain than it is: provenance (source, age, "not checked with the airline") stays
  visible without hovering; "not searched" is never shown as "no flights" (Product principles 1 and 2).
- A search that spends money without the operator seeing the cost first, or that runs past a cap.
- A default that silently schedules runs the operator did not ask for.
- A flight read from Google's list presented as a verified itinerary: it carries no verdict class and never
  says "verified".

## 3. The first screen

Layout **B** (agreed): the operator's searches are the main column, the new-search form sits beside it on the
right; at phone width the form moves above the list. This screen is the app's landing view (replacing Dates
as the default) and the nav's first item, "Searches".

**Each saved search** is one card:

- the route ("Birmingham → Frankfurt"), the window ("10 Jan – 31 Mar"), the stay ("10–14 nights"), and
  "repeats Mondays" when it has a schedule;
- its state in words: "Searching · 120 of 405 date pairs · about 1h 40m left", "Searched 2h ago", the stop's
  own sentence as revision 55 words it (no "Stopped:" prefix) with its fix, "Not searched yet";
- the cheapest price found by its latest run and its dates ("£86 · 12 → 23 Jan"), always through the price
  component's compact face (source, age, "not checked" on a cached price, the stale mark), so its own age and source
  are visible whichever run fetched it (*ruled on the brief's review*: design anti-goal 1 wins over "age only when
  not from the latest run"), and "cheapest so far" while it is searching;
- actions: **See dates** (its page), **Search again**, **Edit**, and **Remove** (soft delete, `DELETE
  /api/definitions/:id`; inline confirm with an undo line, no modal; *my call*). On a search that is pending or
  running, Remove reads "Cancel and remove" and cancels the run first. Undo restores the search as it was, its
  schedule included (*ruled on the brief's review*); a search whose only runs were tool runs cannot be restored.

Order: running first, then by latest run, newest first (*my call*). Tool-run and deleted definitions are not
listed (they are already soft-deleted). Searches that exist today, including old test searches, are listed
and can be removed.

## 4. The new-search form and Search now

### 4.1 Fields

Shown: **From**, **To** (the existing airport search, one or more airports each), **Leave between** two dates,
**Stay** min to max nights. Dates are shown and entered as "10 Jan 2027" style, not "10/01/2027" (*my call*).
The airport search ranks a same-country match for the operator's locale first when two places share a name
(Birmingham GB before Birmingham US); *builder to choose the signal* (point of sale, or the browser locale).

Under **More options**, already filled in: longest journey each way (25 h), cabin (economy), rolling instead
of fixed dates, the sources to use, the name (suggested from the airports), and the budget fields. The
pre-set arrival window 06:00 to 23:00 is **removed** from the defaults: a time window applies only when the
operator sets one (*my call*; the walkthrough user never asked for it and could not tell it was there).

### 4.2 Defaults that work

- **Sources.** A new search names, **stored on the search when it is created** (*my call*), every **free**
  source the install has configured and enabled for discovery. Existing searches keep the sources they name; a
  source set up later is added by editing. The free sources are: the Aviasales cache when `TRAVELPAYOUTS_TOKEN` is set, Google Flights prices via Camoufox when
  `CAMOUFOX_ENABLED` is true. Paid sources keep the §8.2 preset rule (SearchApi only on the 40usd plan).
  `CAMOUFOX_ENABLED` stays the install-level opt-in (§2 l.131), so the browser still runs only where the
  operator set it up; what changes is that a definition no longer has to tick it again.
- **No schedule.** A new search has no schedule. Repeating is added afterwards from its page ("Repeat
  weekly…", which opens the existing schedule fields).
- **Running is not scheduling.** `enabled` keeps one meaning: **scheduled runs happen**. A manual run (Search
  now, Search again, Run now) is never refused because a definition is not enabled. Revision 27's intent
  (nothing runs unattended without the operator's say) is unchanged, since an unscheduled search only runs
  when pressed. The engine's `disabled` refusal applies to scheduled firings only.
- **No automatic resume for a run of an unscheduled search** (*Ian ruled 2026-10-31*). A manual run of a search
  with no schedule that pauses gets no `resume_after`; neither the one-shot resume job nor the boot's auto-resume
  carries it on. Its stop sentence says when the limit resets and offers Search again or Resume. Scheduled searches
  keep today's automatic resume. Two stops follow from this for every search, scheduled or not (*ruled on the
  brief's review*): a stop at the browser worker's **monthly** page limit never offers Resume (a resume past the
  run's browser window reads no browser pages); its text says when the limit resets and offers Search again, a
  fresh run, and on a scheduled search adds that the next scheduled run picks the pages up; a stop at the browser
  worker's **per-run** page limit likewise offers Search again (prices already found are reused), not Resume. And a
  scheduled firing supersedes a stopped manual run of the same search (cancelled with its cause recorded, then
  started), so adding a schedule is never blocked by an old stopped run. "Repeat weekly…" opens the schedule fields
  with the estimate sentence, and its Save stores the sentence's confirmation: that is the schedule's confirmation,
  which scheduled runs use.

### 4.3 The estimate and the confirmation

Beside the button, one sentence built from the existing estimate: "About 2½ hours · free · asks about all 405
date pairs", or "About 3 hours · about £1.20 · asks about 300 of 405 date pairs this run, the rest when you search
again" (*ruled on the brief's review*: the coverage is worded as what is asked, never as prices found, with "cached
prices only where travellers searched recently" when the Aviasales cache is the only source reaching those pairs;
"the rest next Monday", from the schedule, when the search is scheduled). "Free" only when no source on a paid plan
is used; capped calls are named ("uses about 120 of the 9,880 SearchApi searches left this month"). Sources not
used and caps that bind are named in words ("Google Flights via SearchApi is not used: no calls left this
month"), a blocked paid line with its cost as not included (*ruled on the brief's review*: the press stores only
what was shown, the runnable totals, as the search's confirmation). The detailed budget-fit table moves under More
options.

**Search now is the confirmation.** The press confirms the estimate shown beside it (§7 l.1658: confirmed
values come from an explicit confirmation after seeing the estimate; the button and its sentence are that).
When the run costs money, the button carries the cost ("Search now · about £1.20"); when the engine's soft
confirmation would trip (cost above `SOFT_CONFIRM_PENCE`, or one provider's calls above 20% of its cap), the
sentence says so and the press confirms it. The form sends the confirmed values, the estimate is fetched
automatically as the fields change (no "Show estimate" step), and the button is disabled with the reason in
words while the estimate is loading or the form is incomplete.

### 4.4 What the press does

**Search again** (on a card or a search's page, *my call*) starts a run with the search's stored confirmed
values, the rule scheduled runs already follow. When today's estimate exceeds them, or the engine's soft
confirmation would trip, the press does not start a run: the estimate sentence appears inline beside the
button, now labelled with the cost ("Search again · about £1.20"), and a second press confirms and starts it.
A free search inside its stored confirmation starts on the first press. **A confirmation covers that run only**
(*Ian ruled 2026-10-31*): the second press confirms the run it starts and stores no standing confirmation;
scheduled runs keep the confirmation given when the schedule was set, and when their cost rises past it they are
skipped and the page says so. **A Search again on a stopped search starts fresh** (*Ian ruled 2026-10-31*): when
the latest run is paused or interrupted, Search again (and Search now on an edited search) cancels it, recording
its stop cause, and starts a new run in one immediate transaction; a separate Resume stays where carrying on makes
sense.

One press of Search now: save the definition, start a run with the confirmed values, and open **that search's page**
showing its progress. If the save works but the start is refused, the page opens with the refusal in words
and the one fix (§5.2). Editing a search ends with **Save and search again** (and a plain **Save**); either
acts on the search being edited, never on another.

The header's **Run now** button and its search selector are removed (*ruled on the brief's review*). Every run
action lives on the search it acts on (its card or its page), so the wrong-search trap cannot happen. The status
bar stays for the glance (is anything running or failing, the month's spend), and its failing count links to Status.

## 5. A search's page

The current Dates view becomes the page of one search, reached from its card (and from alert emails, as
today). Top to bottom, as in the agreed mockup:

### 5.1 The header

Route, window and stay; one plain line saying when it was searched, how many date pairs were priced and how
many showed no price, and which source ("Searched today 09:12–11:41 · 384 of 405 date pairs priced, 21 showed
no price · the browser worker"; the source in its main-path name, from the one table the brief gives). Actions:
**Search again**, **Edit**, **Repeat weekly…** (or the schedule in words, with "Change").

### 5.2 Running and stopped

- **Running:** "Searching · 120 of 405 date pairs · about 1h 40m left", from the execution's progress and the
  existing `estimatedFinishAt` (`GET /api/executions/active`). Prices appear on the board as they arrive.
  Cancel sits beside it.
- **Stopped:** one sentence naming the cause and one action. Every path that pauses or stops a run stores a
  reason the page can show: the all-sources-disabled path (`discovery.ts:165`, `execute.ts:129`) stores which
  sources were unavailable and why (for example "The browser worker isn't answering, so nothing was
  searched"), with the fix ("Start it with `pnpm gmt start`, then Search again" or "Resume"). The fallback
  "Paused: paused: error" is removed. Counts on the page never contradict the state: a run stopped because no
  source could run says "0 of 405 searched", not "0 error". A run stopped before causes were stored reads "No
  reason was recorded for this run", never its raw stored message (*ruled on the brief's review*).

### 5.3 Cheapest dates, with their flights

The cheapest date pairs come first. Each date pair shows its dates and nights, its price and, when the
browser worker read its flight list (§6), up to three flights: outbound departure time, flight time, changes,
airline and price, with "Flights read 11:44 · prices from Google Flights, not checked with the airline". A
date pair without a flight list says "Flights not read yet" and offers **Read flights for this date (free, 1
page)** when the worker is set up. Every date pair has **Open in Google Flights ↗**, using the existing
generated link (`core/results/searchLink.ts`, re-checked against the allowlist on output, §5.2 l.1199), in the
URL form the worker loads (returning, `hl=en-GB`, `gl=` the point of sale) so the page opened is the page read,
with the search-link label beside it (*ruled on the brief's review*). The flight read's outcome is stated on the
date pair's main line beside its price ("Google's list: from £92, 11:44" / "not in Google's list" / "Google's
list showed no flights"); rank, price and coverage stay unchanged (*ruled on the brief's review*). **Superseded by
spec revision 56 (WP21):** where the worker's recording session set the return and booking flags (the operator's Mac at
present), the block also shows the return flights and the sellers' offers for the selected outbound, the cheapest of
the sellers read leads the date pair while the list is fresh and the offers are complete, and the read costs 1 page,
or 2 with a second outbound; the main spec is current and this paragraph mirrors it.

**Ties** are stated once: "4 date pairs tie at £86, listed by shortest flight time". Within a tie, pairs with
flights read sort by shortest outbound flight time, then fewest changes, then earliest departure; pairs
without flights read keep today's order after them (*my call*).

How many date pairs are listed: the 10 cheapest (*my call*), with the existing filters and "show more".

### 5.4 Every date, by month

The month overview stays below, with a key in plain words ("brighter is cheaper", "striped: not searched",
"each dot is one stay length"). Its symbol set is reduced to what a first-time reader can hold: priced (by
shade), no price shown, couldn't be read, not reached, not searched (*ruled on the brief's review*: a failed read
is its own mark, never "no price shown", and is counted the same way in the header, the cards and the key).
*Builder* proposes the reduced key in the work brief.

### 5.5 STALE

A price is stale only when its **own** worst-case age (fetch age plus its stored `max_age_hours`) exceeds a
threshold built from the definition's refresh hours plus **that same stored** `max_age_hours`, not the
currently registered provider's declared age (`apps/api/src/read/rows.ts:52`). A price fetched by the latest
run of a search, within its refresh interval, is never stale (the per-price threshold above gives exactly this
for a price whose age is assumed or unknown, the case above, with no further clause; a price the vendor dates
keeps its own age, so an old vendor-dated price is never hidden). The age shown stays "1h ago · Google's age
assumed up to 24h" so the assumption remains visible. `CALENDAR_STALE_AFTER_HOURS` keeps overriding when set,
outright.

## 6. Reading flights for the cheapest date pairs

### 6.1 What it is

After a run's discovery stage, when Google Flights prices via Camoufox is one of the search's sources, the run
opens Google's flight list for the **10 cheapest date pairs on the search's board** (any source, including
prices reused from earlier runs; one airport pair each: the cheapest), and stores the flights it reads. On
demand, the same read runs for one chosen date pair. It is free.

**Which pairs are read again (*my call*).** A date pair whose newest flight list was read and is younger than
0.9 × the search's camoufox refresh is not read again; its stored list is shown with its age, as reused prices are. The page shows
the newest flight list for a date pair. Reuse and display key on the airport pair, the dates, the cabin and the
point of sale (*ruled on the brief's review*): a list is shown only when its airport pair is in the current
space, labelled when it differs from the price's airport pair.

**When the run reads them (*ruled on the brief's review*).** The flight-list step runs after discovery when the
run has not stopped, or when its only stop is the browser worker's own per-run page limit (the step then still
runs on its own allowance and the run stays paused, its stop sentence noting the flights read). It never runs on a
catch-up, on a single-cell verification, after the browser window closed, when the browser provider is disabled
for the run, at the monthly page cap, or outside the window. Its pages go through the same gate as the grid's; a
gate refusal ends the step with nothing recorded and is not a cancel.

**Pages and caps (*my call*).** Flight-list pages have their own per-run allowance equal to the flight-list
count (10), **outside** the run's grid page cap (`CAMOUFOX_EXECUTION_PAGE_CAP`), so a first pass that uses its
whole cap still leaves the flights to read. They count against the camoufox **monthly** page cap like any
other page, and a flight read that would pass it is not made (§6.4). No new setting. The estimate shows both
("+ flights for up to 10 date pairs, about 12 minutes": one page at a time, each `CAMOUFOX_MIN_SPACING_SECONDS`
plus 40 seconds, 700 seconds at the defaults), and the budget snapshot records the allowance.

**On demand while a run is going (*my call*).** "Read flights for this date" is refused while any run is using
the browser worker, with the reason in words ("The browser worker is busy with a search; try again when it
finishes"). Otherwise it is a one-page read counted against the monthly cap only.

### 6.2 What is read and stored

The worker already matches each flight's price, stops, marketing and operating carriers, departure date,
airport names and duration on the list page (`apps/camoufox-worker/src/names.ts`) but returns only the
minimum price. It now also captures **departure and arrival times** (and the arrival day offset) and returns
**every flight the list page shows**, up to 30 (*my call*; *builder to confirm it fits the answer limits*), so
the page can choose among them later without reading again.

**Which flights the page shows (*my call*).** Up to three: first the flights within the search's longest
journey (on the outbound duration), cheapest first, then by shortest flight time; when none fits, the cheapest
three, each marked "outbound 26h: over your 25h limit". A line under them says how many more were read and how
many are over the limit, with "show all". When the search sets an arrival window, a flight outside it is marked
the same way ("arrives 03:10, outside your window") and counted in that line, and the shown set always includes
the shortest flight within the limits (*ruled on the brief's review*).

**The date pair's price (*my call*, superseded).** As first designed, a flight read never changed the date pair's
price, coverage or tie: the headline stayed the price the date grid (or cache) gave, with its source, and a
differing cheapest flight read was said in one line. **Ian ruled on 2026-11-01 (WP21, spec revision 56)** that
once a date pair's return flights are read, its headline figure and its board rank use the cheapest pairing total
within the search's limits (outbound plus return, as the return list states it), with the flight list's source and
fetch time, never "verified"; the date-grid price stays beside it ("date grid showed £564"); a date pair not read
keeps the grid price, marked as such; coverage and the buckets are unchanged. The main spec is current.

Stored per flight list: execution, origin, destination, departure and return dates, fetched at, source
`camoufox`, and per flight: outbound departure time (local), arrival time and day offset, duration in
minutes, stops, carriers, price in pence with its currency and point of sale. It is a new record kind (*builder
names the table*), not a fare offer and not an itinerary.

### 6.3 What it is not

It is not verification. It has no flight numbers and no airport codes per segment. As first built it had **no return
leg** (the list shows outbound flights priced as round trips); spec revision 56, WP21, adds the return flights
listed with the one or two selected outbounds (not every pairing), each with the round-trip total the page stated for that pairing
(the main spec is current). Still, it cannot build a `RawOffer` or an itinerary identity (§2 l.449, §6.4). Therefore:

- it carries no verdict class and never says "verified";
- constraints are shown against it only where the read covers them, and say what they cover: "outbound 26h:
  over your 25h limit", "return leg not read";
- it does not feed alerts, History's itinerary series or the verified results basis;
- Camoufox stays "discovery only" in §2; this is a new read beside discovery, named in §2 as its own
  capability, with the per-run allowance of §6.1 under the existing monthly cap.

### 6.4 Failure

A flight-list page that fails, is refused or hits a cap leaves its date pair "Flights not read" with the
reason in the detail, and never changes the date pair's price or coverage. The run's state reports it
separately ("flights read for 8 of 10 date pairs").

## 7. Words

Main-path replacements, applied to the first screen, a search's page, the form, the Edit page and its More
options, and the status bar (*ruled on the brief's review*: the word sweep covers Edit and More options too; a
set-up term that stays there carries a one-line explanation, as the set-up views keep their exact terms with one
where first shown):

| Today | Instead |
|---|---|
| definition, search definition | search |
| cells, discovery tiles | date pairs (and airport pairs where both matter) |
| discovery / itinerary search | the first pass across your dates / reading flights |
| about 0 calls, hard stop 6 | free / about £1.20, stops at £5 |
| priced · no fares · no cached data · skipped · not searched | priced · no price shown · not searched (details under the count) |
| STALE | "older than this search's refresh" only when true |
| Paused: paused: error | the cause in a sentence (§5.2) |
| verdict class, calendar basis, itinerary-search basis | "from Google's date grid" / "flights read" / "checked fares" |

The binding terminology of §11 still holds (never "live", "bookable", "guaranteed", "real-time", "all
combinations"; "verified" only beside verified values).

## 8. Navigation

Searches (the first screen) is first and always the landing view, whatever the number of searches (*ruled on
the brief's review*: Ian's first screen is his saved searches and the form, so nothing opens past it). A search's
page replaces "Dates" in the nav: its entry is the search last opened, named by it, and opens from a card. The
header's search selector is removed. History stays reachable from a search's page. Set up keeps Providers,
Alerts and Status. Old URLs (`?view=dates&def=…`) land on that search's page; `?view=dates` without a search
lands on Searches.

## 9. Constraints

- The main spec's rules on provenance, coverage buckets, budgets and caps, the binding terminology, the browser
  window and the worker's rules are unchanged except where this design says otherwise.
- Privacy: the worked examples are London → New York and Birmingham → Frankfurt; no operator route in the
  repository.
- Public wording rules for the camoufox provider apply to all code, comments, docs and commits.
- Project rules: no `as` casts; event-driven tests; Windows known-failures list; scoped Stryker on changed
  files; one PR, squash-merged.

## 10. Main spec sections this changes (for revision 55)

§2 (Camoufox: defaults; the flight-list read and its caps), §3 (vocabulary), §6.9 (results basis: flight
lists are not a basis), §7 (the flight-list table; `enabled` means scheduled; stored pause reasons), §8.1
(manual runs ignore `enabled`; the flight-list stage; stop reasons; stale threshold), §8.2 (presets: free
sources named, no default schedule, no default arrival window), §10 (endpoints: flight lists per date pair,
on-demand read, create-and-start), §11 (the first screen, the form, a search's page, words, nav; Run now
leaves the header), §12 (no new settings expected; the flight-list count of 10 is a constant unless the
builder finds a reason for a setting), §16 (work package), §17 (changelog).

## 11. Left to the builder

- Whether the flight-list stage is a new engine stage or a step of discovery, within §8.1's lifecycle.
- The record and endpoint shapes, and how the worker request asks for a list page with flights.
- The reduced month key (§5.4) and the exact locale signal for airport ranking (§4.1).
- How the page shows a search with several airport pairs (cheapest airport pair per date pair, with the other
  airport pair's price beside it, as the board does today).
- Splitting the work into tasks; the PR lands as one squash-merge.

# Show the answer, not the engine: UX redesign

Written 2026-11-08. Status: stage 1 (the Trip page, the labels and the booking link, §5 and §6) is folded into the
main design spec (`2026-10-14-flight-price-optimiser-design.md`) as revision 69; the main spec governs what is built.
Stages 2 to 4 (§7) are folded in as their own revisions when they ship; until then, where the two differ, the main
spec governs. Choices marked *(my call)* were made by
the author, not the operator. The operator approved the direction and the mockups on 2026-11-08 ("that's MUCH
better"); the mockups are in `2026-11-08-ux-redesign-mockups/` (London → New York example data, light and dark,
375 px and desktop; pink dashed boxes are notes, not design). Where a mockup and this document differ (labels of the other returns, the connecting city), this
document governs.

## 1. Why

The operator's own words, 2026-11-08: "I just want to search for flights"; "Why is the UI so hard to work with?";
and, on the page for one pair of dates, "How the hell do I interpret anything from this page".

What he wants, in his words: review existing searches; see the cheapest 2–3 trips of each, with date, trip length,
journey time each way and number of changes; create a new search; and "book it by clicking on the provided price to
be taken to the booking page for that flight at the provider".

A UX review of every screen on 2026-11-08 found the app collects the right data but shows its paper trail instead of
the answer:

1. **The screens contradict each other.** The search's page shows a £603 trip with a seller and flights read for a
   pair of dates; that pair's own page says "No round trip found yet" and never shows those flights. (The page reads
   price rows only and never the browser's flight lists.)
2. **Nothing can be booked.** No price is a link; the only way out is a Google Flights search link at the bottom of
   a closed fold.
3. **Each price carries 6–10 lines of qualifiers.** Ten board rows are about 3,500 px tall; every row says "NOT
   CHECKED", even those whose flights were read.
4. **What he asked for is buried.** Journey time each way and changes sit in grey prose; the Journey column shows
   the round-trip total.
5. **Engine internals are on the main path:** run-timestamp paragraphs, 54-row per-run, per-stage, per-provider
   tables open by default, basis and verdict-class filters, a 15-entry legend, "this month: £0 of £0".

## 2. Goals

1. Every price the operator sees carries **one** short label, and the detail is one tap away.
2. How certain a price is shows by **where it sits**: the "Cheapest trips" lists hold only trips whose flights were
   read; calendar and cached prices live in their own section and on the calendar.
3. **The price is the booking link**, to the best target available (§5.3).
4. Every screen that shows a pair of dates shows the **same** price for it, from the same rule.
5. Four screens: **Trips** (home), a **Search**'s page, one **Trip** (a pair of dates), **Settings**. History,
   Alerts, Providers and Status become sections of those.
6. Engine internals sit behind one "Search log" fold, never on the main path.

## 3. Non-goals and anti-goals

- **Honesty stays.** Nothing here relaxes what a price may claim: a calendar price is never shown as a trip's price,
  a "from" price is never shown as a seller's, an old price always shows its age, and no state lets "not searched"
  or "couldn't read" look like "no flights". The rules move from inline prose into the label, its tap detail and
  placement; they don't go away.
- **No new data sources and no new spend.** SearchApi stays off by default (§8, question 2).
- **Not a restyle for its own sake.** The departure-board look stays for the logo only; data is plain text.
- **Anti-goal:** a screen that explains why two screens disagree. If two screens disagree, fix the data path.
- **Anti-goal:** an action that can't run shown as a button (today's "Search … for itineraries (uses billed calls)"
  that sends the operator to the new-search form). An action that can't run is not shown; if its absence needs
  explaining, one plain sentence says what to change, linking to it.

## 4. Screens

| Screen | What it's for | URL | Reached from |
|---|---|---|---|
| **Trips** (home) | Each search's cheapest trips you can book, and a new search. | `?view=searches` (default) | Nav, logo |
| **Search** | One search: its cheapest trips, cheaper-looking dates not read, the calendar. | `?view=dates&def=` | A search's name, "All trips and dates" |
| **Trip** | One pair of dates, ending in a booking link. | `?view=trip&def=&depart=&return=` | › on any trip row, a calendar day, an alert email |
| **Settings** | Price sources, limits, email and alerts, system health. | `?view=settings` | Nav; the top bar's health line |
| New search / Edit | One form: four fields, sources, More options. | `?view=definitions&edit=` | "+ New search", Edit |

The nav has two items, **Trips** and **Settings**; breadcrumbs sit below it (Trips › London → New York › 11 → 28
Nov). A top bar shows remaining limits and one health line ("All working"; amber or red "Browser not responding ·
fix", linking to Settings › System).

Old links keep working: `view=results` with dates (alert emails, bookmarks) lands on `view=trip` with the same `def`,
`depart` and `return`, and keeps the search page's airport and journey filters (`d.from`, `d.to`, `d.journey`); it drops
`basis`, `row`, `sort` and the `f.*` filters. A `view=results` link with only `row=` (an alert email sent before revision
48) lands on the search's page. `view=history|alerts|providers|status` land on the section that replaced them once it
exists.

The mockups show each screen's default content and states; `01-searches.html` (Trips with the new-search panel),
`02-search.html`, `03-trip.html` (including every state of its top card) and `04-settings.html`.

## 5. Prices

### 5.1 One label per price

A label is `Kind · age`. Tapping it opens a two-line explanation. The age is always shown and turns amber once it
is older than the search's refresh interval. Source codes (CF/TP/SA), market, airport and "constraints not checked"
never appear on a main surface; they are in the tap detail and in the Trip page's "About this price".

| What the price is | Label | Colour | Tap detail (short) |
|---|---|---|---|
| A seller's price on Google's booking page for the two chosen flights, read by the browser | **Seller · 3h** | green | "A seller's price as Google's booking page listed it (Kiwi.com, cheapest of 16), read 3h ago. Not checked with the seller or airline; it can change at checkout." |
| A seller's price from SearchApi's booking options | **Seller · 3h** | green | Same, plus "Your limits checked: stops, journey time." |
| Google's price for one exact outbound and return, with no seller listing read: the return's "from" price on Google's return list (booking page not read, or read incompletely), or SearchApi without booking options | **Google price · 3h** | blue | "Google's price for these two flights. No seller's price was read; the booking page may show a different total." |
| Google's "from" price for an outbound whose returns weren't read (its cheapest return, unknown) | **Google list · 3h** | blue | "Google's 'from' price for this outbound on its flight list. Its returns and sellers weren't read." |
| Google's date-grid price (browser or SearchApi) | **Calendar · 3h** | amber | "Google's calendar price for these dates. Not a fare: no flights or sellers read, and your journey limit isn't checked." |
| Aviasales cached price | **Cached · 2d** | grey | "A price an Aviasales user saw up to 2 days ago. Not a fare quote." |
| A price the latest search didn't see again | **Not seen again · 5d** | outline, price greyed | "Read 5 days ago; today's search didn't find it again. Probably gone." Ranked after current prices. |

States that show no price: **Not searched**; **No price listed** (detail: "not the same as no flights"); **Couldn't
read** (with Try again); **Not reached: the search stopped at its limit**.

The label's kind comes from one function over the price's existing provenance (provider, source kind, the pairing
kind of `pairingKindOf`: seller / google-unread / google-incomplete, observed time, whether the latest run saw it).
Every surface uses that function; none builds its own wording. *(my call: where it lives — core beside
`pairingKindOf`, or the web's lib — is the plan's choice, but it is one function with its own tests.)*

### 5.2 Placement

"Cheapest trips" (on Trips and Search) only ever holds Seller and Google price rows: trips whose outbound and return
flights were read. The ranking stays as shipped in revision 68 (fresh reads, then older reads with their age).
Calendar and cached prices live in "Lower on the calendar, flights not read" and on the calendar itself.

### 5.3 Booking target

A price is a link to the best target available, best first:

1. **The seller's own link**, when SearchApi read the trip's booking options (the existing `Booking` get/post).
   Button: "Book on <seller host> ↗".
2. **Google's booking page for the two chosen flights**, when the browser recorded its address (§6.3). Button:
   "Book on Google Flights ↗", with one line under it: "Opens Google's booking page for these two flights, where
   the sellers are listed."
3. **A Google Flights search for those dates** (the link the app builds today). Button: "Find on Google Flights ↗",
   never "Book".

A calendar or cached price links to its Trip page, not out of the app: there is nothing to book until flights are
read.

## 6. Stage 1: the Trip page, the labels and the booking link

The page the operator swore at is replaced first.

### 6.1 The Trip page (`03-trip.html`)

Heading: the dates and nights ("Wed 11 Nov → Sat 28 Nov · 17 nights"), breadcrumbs above.

**The answer card**: the price in large type, its one label, "Kiwi.com · cheapest of 16 sellers", the booking
button (§5.3) and its one line. Under it, **Out** and **Back**: departure and arrival times with airport codes, the
day (and "lands Sun 29 Nov" when it arrives another day), duration, changes ("direct", "1 change"), airline.

The card shows **exactly the figure the Search page's row shows** for these dates: it is built by the same code
path (`datePairFigures` / `pairingsFor`), not by a second query that can disagree. The Search page's filters that
change a date's figure (`d.from`, `d.to`, `d.journey`) travel in the Trip link and the breadcrumb back, so the two
agree with a filter on *(my call)*. Where the figure picks one airport pair among several for these dates, the card
shows that pair and "About this price" names the other pairs' states in one line each. Each price on the page is checked on its own: one whose provenance is inconsistent is
withheld, and the rest of the page still shows. A label's detail and "About this price" both name the market the price
was read in ("UK market").

**Actions**: "Read flights again · free, ~2 min" (the existing on-demand read) and, only when SearchApi can run for
this search, "Check with SearchApi · 1 credit" (the existing verify). An action that can't run isn't shown (§3).
The on-demand read today refuses a pair whose newest list is inside the refresh interval (`fresh`) and a pair with
no figure (`no_price`). Asked for from the Trip page, it runs in both cases: the operator asking is the reason to
read *(my call: a free read the operator starts by hand needs no freshness guard)*.

**Other flights on these dates**, from the flight list the card's figure came from (that one airport pair; other
pairs aren't shown in stage 1 *(my call)*): other returns read with this outbound (and with the second attempted
outbound, if any), each labelled **Google price** (§5.1: an exact outbound and return); then other outbounds read,
labelled **Google list** with "returns not read". Each row shows price, label, times, duration, changes and
airline. Rows over the search's journey limit or dearer than those shown fold into one line: "9 more outbounds
read: 6 over your 25h limit, 3 dearer. Show them". These rows link out to the Google Flights search for the dates
(target 3), since no booking page was read for them.

**One click down:**

- **About this price**: what it is, when it was read, what was checked (the journey limit each way), what wasn't
  (the seller, bags, fare rules), and what the calendar and the Aviasales cache said for these dates, each with its
  label.
- **Search log for these dates**: one row per run that touched these dates, plus on-demand reads ("Today 16:40 ·
  calendar £388 · flights £412 Kiwi.com"; "Tue 3 Nov · couldn't read: page timed out"; "Sat 31 Oct · calendar £395
  · flights not read"; "Today 18:05 · flights read by hand · £409"), newest first, five shown, the rest behind
  "Show all N, with each source", where today's per-source detail moves. Why a run didn't read a date's flights
  isn't recorded, so the log says "flights not read" and never guesses a reason *(my call: no new record)*.

**States of the answer card** (the rest of the page stays; most are mocked at the bottom of `03-trip.html`). The
card's state follows the figure the board gives these dates (its basis and its `pairingRead` result), so the card
and the row never disagree. It reads the flight list of the cell whose flights the board read for these dates (the
figure's own cell when the board read none). The first matching row wins:

| Figure / read result | Card says |
|---|---|
| Page can't load its data | one red line: "Can't reach the app's server; showing nothing rather than old prices. [Retry]" |
| The dates are outside the search's dates now (departed, or the search's dates changed; an old alert link) | "These dates are outside this search's dates now." with a link back to the search. The page answers normally; this is not an error. |
| Reading now (an on-demand read in flight for these dates) | "Reading flights for these dates… about 2 min. The calendar showed £388." A bar runs against the measured read time; it is an estimate, not progress *(my call: no new progress reporting)*. |
| A read trip (pairing figure) or a verified price | The answer card above. Older than the refresh interval: the age turns amber; it stays a Seller or Google price (rev 68 ranks older reads after fresh ones). A verified price the latest search did not see again is the "Price gone" row. |
| Calendar price, and an older read trip that does not lead (`within-older`) | "£388 · Calendar · 3h. The trip below was read 3d ago, longer ago than this search's refresh, and doesn't lead." The older trip is shown under it. |
| Calendar price, flights read under limits other than the search's now (`within-other-limits`) | "£388 · Calendar · 3h. Flights were read 3h ago under different limits from yours now." [Read flights again] |
| Flights read, none within the limits (`over-limit`) | "£388 · Calendar · 3h. Flights were read 3h ago: none within your 25h limit each way. The cheapest read was £455 · Google list, 27h 10m out." [Read flights again] The limit named is the one every flight failed. |
| Outbounds read, returns not (`outbound-only`) | "£388 · Calendar · 3h. Outbound flights were read 3h ago, but not their returns." [Read flights] |
| Read, no return listed (`no-pairing-read`) | "£388 · Calendar · 3h. Flights were read 3h ago, but Google listed no return for the outbounds tried." [Read flights again] |
| Couldn't read (the newest list failed), where the board shows a failed read | "The flights page didn't load at 16:42 (timed out). Nothing was saved." [Try again], above the card below it: the calendar price when the figure has one. An older read trip does not lead past a failed newest list; it shows again once the dates are read again. The line appears only where the board shows the failed read. |
| Calendar price only (no read) | "£388 · Calendar · 3h. Flights not read yet, so there's nothing to book here. [Read flights · free, ~2 min]" |
| Price gone (the figure is superseded / not seen in the latest run) | the price greyed, "Not seen again · 5d", and [Read flights] |
| No figure, flights read by hand | The trip, as the answer card, under "No calendar price for these dates; their flights were read by hand 2h ago." (The board ranks no such dates: it has no figure for them.) |
| No figure, every price found is over the journey limit set on the search's page | "Every price found for these dates is over the journey limit set on the search's page." |
| No figure, a cell errored | "Google's page for these dates couldn't be read in the latest search. Nothing was saved." It is never worded "no price". |
| No figure, no price listed | "Google's calendar listed no price for these dates in today's search. That doesn't mean there are no flights. [Read flights]" |
| No figure, the sources had no data | "The price sources had no data for these dates in the latest search. That doesn't mean there are no flights." |
| No figure, the search stopped at its limit | "These dates weren't reached: the latest search stopped at its limit. They'll be searched next time." |
| No figure, the browser wasn't available | "These dates weren't searched: the browser wasn't available for the latest search. They'll be searched next time." |
| Not searched | "These dates weren't searched: the latest search stopped before reaching them. They'll be searched next time." |

A read trip is never "Not seen again": an older read shows its age instead. Every `pairingRead` value and figure
basis the API can send maps to one row of this table, with a test per row; a value with no row is a defect, not a
fallback.

**Gone from this page**: the run-timestamp paragraph, the basis switch, the filter panel (verdict class, carrier
codes, "has this constraint unverified", "hide stale rows"), the "Dates board price" box, the default-open outcome
tables, the "How far checked" column, the round-trip total journey time, split-flap lettering, and the words
definition, cell, date pair, basis, discovery, itinerary search, verdict, reused, superseded and billed calls.

### 6.2 Labels and links elsewhere in stage 1

Stage 1 changes the other screens only as far as the new page needs. Each trip row and calendar day on the Search
page links to its Trip page: the row's date cell is the link, and a click on the row still opens it in place. On a
Trips card, the trip's price opens that trip's Trip page: the cards' booking targets come with stage 2's card
redesign, since the cards' read carries no booking inputs today.

A Search page row shows one label for its price (§5.1); the source and age chips it carried are gone. A row's price
is a link by §5.3's rule: a read trip's price (a Seller or Google price row, and a verified row too) links to the
booking page its read recorded, else to the Google Flights search for its airports and dates. The search link uses the
default GB point of sale. A calendar price and a synthetic price are not links. Opening a label's detail pushes the
content below it down, at every width: no floating panel. The rest of those screens changes in stage 2.

### 6.3 Recording the booking page's address

When the browser worker reads a booking view (the page after a return is chosen), it already knows the page's
address (`page.url()`), and today keeps only the path for classification. It records the whole address with the
booking read:

- The worker answer's booking read (`bookingReadSchema`, shared by worker, engine, DB read and API) gains
  `bookingUrl`, nullable. It is set only when the view classified as the booking view and the address passes
  `validateVendorUrl` against the browser provider's allowlist (`google.com`) with the booking path; otherwise null.
- A migration adds the column to `flight_lists`; rows read before it have null and fall back to target 3.
- The address is not written to logs (the worker logs the path only, as now).
- No extra page load, click or request: the address is read from the page already open.

Whether that address still opens the same two flights later, in the operator's own browser, is not known yet. The
operator tests it by clicking a price after the first run. If it doesn't, the button falls back to target 3 and the
recording is withdrawn. *(my call: record it now rather than test first — it costs one field, and the test needs
a real recorded address.)* The existing recordings keep only host and path, so the worker test feeds a booking
view's facts with a made-up address of the real shape; no new recording is taken for it *(my call)*. The first
real run after the merge is the check that the address is captured.

### 6.4 Not in stage 1

- **Connecting city and layover length** ("1 change: Dublin, 1h 30m" in the mockup). The browser's flight list
  reads only the number of changes; the row text it reads has no layover city or time. Stage 1 shows "1 change";
  reading the connection needs a worker change checked against recordings first, and is its own later item.
- The nav, top bar and breadcrumbs beyond the Trip page; the Trips and Search redesign; Settings.

### 6.5 Done when

- `?view=trip&def=&depart=&return=` renders the page above for any pair of dates of a search, with every card
  state reachable from real data (tests drive each state from API responses), at 375 px and desktop, light and
  dark, with no sideways scroll.
- For every pair of dates, the Trip card's price, label and seller equal the Search page row's (one test over the
  same API data).
- A browser read records `bookingUrl` (worker test from booking-view facts; engine and DB round-trip tests),
  and the Trip page's price links to it; older reads link to the Google Flights search, labelled "Find".
- "Read flights again" from the Trip page runs on a pair read inside the refresh interval and on a pair with no
  calendar price (engine tests).
- `view=results` links open the Trip page.
- The main spec's §11 says what the Trip page shows, in a new revision; the Results view's description is removed.
- The banned-word and main-path-word sweeps pass over the new copy.

## 7. Later stages

Each gets its own plan, from this design and the mockups, when the previous one has shipped.

- **Stage 2: Trips and Search.** Trips cards: three cheapest read trips each (price as link, label, dates, nights,
  Out and Back time · changes, ›), one line naming how many dates look lower on the calendar, Search again / Edit,
  and every card state in the proposal (running with progress and Cancel, nothing found with the reason and fix,
  never searched, stopped at a limit). New search in a side panel (below the searches on a phone): four fields,
  where to look (three checkboxes with their cost), More options (journey limit each way, cabin, repeat, rolling
  dates, name), a one-sentence estimate. Search page: one filter row, Cheapest trips (5, then "Show 10 more"),
  Lower on the calendar (3, each with Read flights), a calendar with prices printed and a three-item legend, and the
  folds Price over time, What was searched, Alert. The nav becomes Trips and Settings, with the top bar.
- **Stage 3: Settings** (`04-settings.html`): price sources with on/off, keys stored in the database and write-only
  in the UI, SearchApi credit read from its `/me` endpoint, the browser's stopping rule, limits, email (Gmail app
  password or SMTP, send only, a test email), alert rules, and System health. New searches inherit the source
  switches; each search has its own and existing searches don't change when Settings does.
- **Stage 4: folding the rest.** History becomes Price over time on the Search page (the cheapest read trip per
  run, the calendar low as a faint dashed line); Alerts become one line on the Search page plus the rules list in
  Settings; Providers becomes Settings › Price sources; Status becomes Settings › System and the top bar's line;
  coverage becomes "What was searched". The old views are then removed.

## 8. Decisions the operator hasn't made yet

The operator approved the direction without answering these; each is decided as below *(my call)* until he says
otherwise:

1. **Booking page address**: recorded (§6.3), and tested by the operator clicking a price.
2. **SearchApi's job**: off by default; a per-search switch arrives with stage 3. With 38 credits left, checking
   every search's cheapest trips by default would spend them in a few runs.
3. **The word "Seller"** for a seller's price as Google's booking page lists it, not checked with the seller: kept.
   The tap detail says it wasn't checked with the seller or airline.
4. **Alerts**: one kind, "email me when a trip with flights read is under £X", from stage 4; the percentage and
   amount-drop rules are withdrawn then.

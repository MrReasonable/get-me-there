# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Anyone technical who self-hosts get-me-there from the public repository. Each install has one
operator: someone who makes long-haul round trips several times a year, has flexible dates, and
cares about price without accepting any itinerary at any cost (very long journeys, many stops).
The original operator is one of these people, not a special case: nothing in the product assumes
a particular route, habit or knowledge of the project's history.

Operators are comfortable with a terminal, an `.env` file and either Docker or a user service.
They are not assumed to know the flight-price vendors, their caches or their limits; the app
explains those where they affect a decision.

## Product Purpose

Answer one question: across a departure window of several months and a range of stay lengths,
which departure and return dates give the cheapest round trip the operator would accept, and how
sure is that answer. It replaces checking date pairs one at a time by hand.

The main decision it supports is **which dates to fly**, with the trade-offs (stay length,
journey duration, stops) in view. Watching a chosen itinerary's price over time (history and
alerts) supports that decision; it does not replace it. The app never books: the operator books
with the airline or an agent.

Success: one press of **Search** on a new search gives its cheapest trips and a calendar of its
months, within budgets the operator sets; scheduled searches keep them current, and an email
arrives when a price the operator watches drops under their threshold.

## Positioning

Honest coverage and provenance, within a hard budget the operator controls.

- Every price states its source, its age and whether its constraints were checked, visible
  without hovering. Each price carries one label saying what it is (a seller's or Google's price
  for a trip whose flights were read, a calendar or cached price, or a price not seen again) and
  its age; the headline is the cheapest trip **found**.
- Coverage is stated cell by cell: a date pair is a departure and a return date; a cell is one
  airport pair on one date pair; coverage is stated per date pair over its airport pairs, so "not
  searched" or "no cached data" can never be mistaken for "no flights".
- The operator sets caps on vendor calls and spend, per run and per month, and on browser pages
  per run, sees the estimate beside the button that runs a search, and the app stops at the caps.

## Operating Context

The operator uses it in four situations, all of which matter:

- **At a desk, deliberately:** studying a search's page (its cheapest trips, the dates lower on
  the calendar, the calendar and a day's stays) and a trip's page to choose dates, then booking
  elsewhere.
- **A quick glance between runs:** has anything moved, is anything failing or waiting on them.
  The top bar on every view carries this: the health line, the SearchApi calls left and the
  month's spend, and the search running now.
- **From an alert email:** its link opens the Trip page for that pair of dates.
- **On a phone:** checking results and status. This needs an install the phone can reach (a
  server or VPS, behind the app's sign-in); a laptop install bound to localhost is not
  reachable from a phone.

Searches run on schedules (cron, in the operator's time zone) and take minutes to hours. A run
can be paused, resumed, cancelled or stopped by a budget cap. The browser price source runs on
the operator's own machine, which must be awake for it. Setup and operation happen through
`pnpm gmt` (setup, status, start, stop, consent) and `docs/setup.md`.

## Capabilities and Constraints

- **Views:** the nav has two items, Trips and Settings. **Trips** is the first screen: the
  operator's searches as cards (each with its three cheapest trips, how many dates have flights
  read and how many look lower on the calendar, and the run's progress while one goes) beside a
  new-search panel (From, To, Leave between and Stay; Where to look, the sources this search
  uses; More options for the longest journey, cabin, Repeat, rolling dates and name; one sentence
  of what the search will take; and **Search**). A **search's page**, opened from its card, has
  its header with the run line, a filter row (stay, From, To, one per week), **Cheapest trips**,
  **Lower on the calendar**, a calendar of its months (each day prints its cheapest trip's
  price, else its lowest calendar price, and opens a panel of its stays) and three folds: Price
  over time, What was searched (with the full search log) and Alert. The **Trip page** is one
  pair of dates, ending in a booking link; it opens from a trip row, a day's panel or an alert
  email. A search's **Edit** page holds the same form with its Limits and checks. **History**
  (price over time for a route) opens from the Price over time fold. **Settings** is an interim
  page linking Price sources, Alerts and System, which keep their earlier look until stage 3 of
  the redesign.
- **Flight lists:** for the cheapest date pairs the browser worker reads Google Flights' own
  list of outbound flights (times, changes, airline, the lowest round trip listed with each),
  selects the cheapest outbound within the search's journey, stops and time limits, and reads the
  return flights Google lists with it (and the next outbound's, from a fresh load of the page,
  when none fits), each priced as Google words it ("from"). It then opens the booking options of
  the shown pairing and reads the offers Google listed. The cheapest of the sellers read leads
  the date pair, on the search's page, its card and the Trip page alike, only when both flights
  are within the search's limits, the list is fresh, it was read under the search's current limits and the
  offers are complete, with the grid price beside it; otherwise the grid price leads and the
  pairing shows beneath it, saying why. When no return fits on either outbound tried, the pairing
  whose sellers were read is shown with its offers, marked over the limits. A read that did not
  finish says when it is read again: at the next search while a read would go now (the Read
  flights button beside it), else once the list is older than the search's refresh. It is not a
  fare check, and the app does not know which price is bookable: economy only,
  one or two outbounds' returns, not every pairing, and booking stays on Google (the app opens no
  seller). Return flights and sellers are read only on worker machines whose recording session
  set the flags (the operator's Mac at present). Coverage and the buckets never change. Each read
  loads up to 2 pages a date pair (a second outbound loads the page again). A run reads the
  cheapest date pairs first, down the calendar, until more reading stops finding cheaper trips (five
  trips with flights read wanted, twelve reads in a row without an improvement ends it), with no page
  allowance; a pair read recently is reused, and a line under Cheapest trips says how reading
  ended.
  Without the worker the page says flight times need it.
- **Price sources:**
  - Aviasales cache (Travelpayouts): free, cached prices up to 48 hours old.
  - Google Flights via SearchApi: paid per call; date grid and itinerary search with booking
    options.
  - Google Flights prices via Camoufox: the app's own browser worker on the operator's machine;
    free, capped in pages a run.
- **Two stages:** discovery (wide and cheap, across the whole window) and verification
  (itinerary search of selected cells).
- **Coverage buckets per cell:** priced, no fares, no cached data, error, skipped, not searched.
  On the main path these are worded as searched, "not searched", "not reached" and "couldn't be
  read"; the six buckets stay in the full search log.
- **Main-path words:** Search, Search again, Searching, Searched, Reading flights, Checking
  fares, Repeat weekly, More options; set-up terms (stages, cells, discovery, verification) stay
  in the full search log and the Calls and caps view (`?view=providers`).
- **Budgets:** caps per run and per month on calls and spend, and per run on browser pages;
  estimates before spending; a ledger of every call.
- **Route-agnostic:** any airports in the airports table; nothing in the product is tied to a
  route. The worked example everywhere is London → New York (LHR and LGW to JFK and EWR).
- **One operator per install;** multi-user use is a non-goal. A sign-in (basic auth) is required
  whenever the app listens beyond loopback.
- **Money:** whole pence internally; the currency is the one the source states; any conversion
  is labelled as a conversion.
- **Binding terminology** (tested over all user-facing text; the full list is spec §11): never
  "exhaustive", "all combinations", "every combination", "live", "bookable", "guaranteed" or
  "real-time". Say "cheapest found", "fetched 12m ago", and name sources as "Aviasales cache",
  "Google Flights via SearchApi", "Google date grid via SearchApi" and "Google Flights prices via
  Camoufox" (compact mark CF). "Verified" appears only beside values of the verified class.
- **Source of truth for behaviour:**
  `docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md`.

## Brand Commitments

- **Name:** get-me-there.
- **Voice:** plain and exact, never more certain than the data. Say what was searched, when, by
  which source, and what was not. No marketing tone and no reassurance beyond the evidence.

## Evidence on Hand

- No testimonials, user counts or benchmarks exist; do not invent any.
- Real prices exist only inside each operator's own install. The repository carries synthetic
  data and the London → New York example (importable from `docs/setup.md`).
- Recorded vendor and browser responses are kept private to each machine and never appear in
  the repository or its screenshots.

## Product Principles

1. **Honest before impressive.** Source, age and verdict class travel with every price.
2. **Coverage is stated, never implied.** What was not searched is shown as not searched.
3. **The budget is a hard stop the operator can see before spending.**
4. **Dates first.** The main views answer "which dates", with the trade-offs in view.
5. **Glanceable state.** Every view says which run it shows, how old it is and whether anything
   needs the operator.

## Accessibility & Inclusion

At 375 px every view stays reachable and usable: the nav is the same two links in one row, the
top bar wraps under it, and compact layouts keep each price's label and age. Keyboard operation
has a visible focus and labelled controls, and no meaning is carried by colour alone. Beyond these and
the spec's other requirements, no formal accessibility standard has been chosen yet.

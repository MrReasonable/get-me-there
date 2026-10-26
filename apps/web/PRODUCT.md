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

Success: scheduled searches keep the ranked table, the calendar heatmap and the price-vs-stay
chart current for the configured search, within budgets the operator sets, and an email arrives
when an itinerary that meets the operator's constraints drops under their threshold.

## Positioning

Honest coverage and provenance, within a hard budget the operator controls.

- Every price states its source, its age and whether its constraints were checked, visible
  without hovering. The headline is the cheapest round trip **found**, with its basis, verdict
  class, provider and age.
- Coverage is stated cell by cell (a cell is one departure and return date pair), so "not
  searched" or "no cached data" can never be mistaken for "no flights".
- The operator sets caps on vendor calls, spend and browser pages, per run and per month, sees
  the estimate before saving or running a search, and the app stops at the caps.

## Operating Context

The operator uses it in four situations, all of which matter:

- **At a desk, deliberately:** studying Results, Calendar, Duration, Coverage and History to
  choose dates, then booking elsewhere.
- **A quick glance between runs:** has anything moved, is anything failing or waiting on them.
  The status bar on every view carries this.
- **From an alert email:** opening the one itinerary whose price dropped.
- **On a phone:** checking results and status. This needs an install the phone can reach (a
  server or VPS, behind the app's sign-in); a laptop install bound to localhost is not
  reachable from a phone.

Searches run on schedules (cron, in the operator's time zone) and take minutes to hours. A run
can be paused, resumed, cancelled or stopped by a budget cap. The browser price source runs on
the operator's own machine, which must be awake for it. Setup and operation happen through
`pnpm gmt` (setup, status, start, stop, consent) and `docs/setup.md`.

## Capabilities and Constraints

- **Views:** Results (cheapest journeys), Calendar (price heatmap by date pair), Duration (price
  against stay and journey length), Coverage (what was and was not searched, cell by cell),
  History (price over time for a route or an itinerary), Definitions (setting up a search, with
  its estimate and budget fit shown before saving), Providers, Alerts and Status.
- **Price sources:**
  - Aviasales cache (Travelpayouts): free, cached prices up to 48 hours old.
  - Google Flights via SearchApi: paid per call; date grid and itinerary search with booking
    options.
  - Google Flights prices via Camoufox: the app's own browser worker on the operator's machine;
    free, capped in pages a month.
- **Two stages:** discovery (wide and cheap, across the whole window) and verification
  (itinerary search of selected cells).
- **Coverage buckets per cell:** priced, no fares, no cached data, error, skipped, not searched.
- **Budgets:** caps per run and per month on calls, spend and pages; estimates before spending;
  a ledger of every call.
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

Every view stays reachable and usable on a phone; navigation wraps rather than hiding views.
Beyond the spec's basic accessibility (keyboard use, accessible names), no formal standard has
been chosen yet.

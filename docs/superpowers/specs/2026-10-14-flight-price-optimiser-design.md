# get-me-there — Flight Price Intelligence & Flexible-Date Optimiser

**Design spec, revision 39.** Written 2026-10-14. Every section is self-contained; nothing refers to a prior revision. Status: **approved by Ian on 2026-10-14 at revision 8** after
four full-roster reviews (145, 140, 126 and 101 findings; zero Critical since
revision 2) and the provider spike. Revision 9 folds in the three decisions
taken at approval (the self-scraping fallback in §2, the dashboard readings in
§2 facts 4 and 7, the $40 plan in §1) and changes no design rule; revision 10
records the contract corrections found while drafting the fourteen work
briefs (§17), none of which changes what the operator sees; revision 11
records the rules settled by the first reviews of those briefs. Review
summaries and the spike record live outside the repository (the operator's
private notes), not in `docs/`; the changelog in §17 maps every finding ID.
The implementation plan under `docs/superpowers/plans/` and the work briefs
under `docs/briefs/` derive from this revision.

This document is the single source of truth for what gets built. The
implementation plan and every per-package work brief derive from it. Where
the original prompt and this spec disagree, this spec wins; the differences
are deliberate and listed in §15.

---

## 1. Purpose and success criteria

The operator makes a long-haul round trip several times a year, has
flexible dates, and wants the cheapest fare that can actually be booked
across a multi-month departure window and a range of stay lengths, without
manually checking date combinations.

**The app is route-agnostic and the docs never name the operator's own
route.** Every search definition carries its own origin and destination
airports, any IATA codes present in the airports table, and nothing about
any specific city or country exists in application code. The worked example
used throughout this spec and in `docs/setup.md` (importable as JSON) is
**London → New York: LHR and LGW to JFK and EWR**, 10–21 nights over a
182-day window; its numbers are illustrations, not defaults.

**Each install has one operator.** The setup command (§13) is written for
anyone technical who clones the public repository, not only for the
original operator; multi-user use stays a non-goal.

**Success looks like:** with provider credentials configured, scheduled
searches keep a ranked table, a calendar heatmap and a price-vs-stay chart
current for the configured space, within a configurable spend ceiling, and
email Ian when an itinerary that satisfies his constraints drops under a
threshold. Every price on screen says where it came from, how old it is,
and whether its constraints were checked. The coverage view makes it
impossible to mistake "not searched" for "no flights".

The headline number is the **cheapest round trip found** and always carries
its basis, verdict class, provider and age. Never "cheapest bookable". The
banned-word list for all user-facing text is in §11 and is a single list.

**Configurations the app must support.** The SearchApi free allowance is a
one-off balance of 100 credits (dashboard wording, §2 fact 7), so the **£0
configuration is Travelpayouts-only**, and SearchApi in practice means the
$40/month plan, which is Ian's approved ceiling and the plan he is
subscribing to (decision 2026-10-14).

| Providers | Discovery | Verification | What the operator gets |
|---|---|---|---|
| none | – | – | empty state explaining what to configure |
| Travelpayouts only (£0) | Travelpayouts | none | calendar basis (§6.9) from whatever Aviasales users recently searched for the definition's pairs; every row labelled "constraints not checked" with the inapplicable constraints named and a search link. Coverage is route-dependent and often thin: the Definitions form's **coverage check** (free, §10) reports cached rows per pair before anything is saved. The spike measured a thin long-haul route at zero cached rows over eight months and busy gateways on the same country pair at four to six a month |
| SearchApi $40 | SearchApi calendar | SearchApi | full product, scraping-derived, labelled |
| both (recommended at $40) | both | SearchApi | authorised cached baseline plus scraped verification |

**What £0 gives, honestly:** cached calendar prices only, no constraints
checked, and coverage that depends entirely on what Aviasales users have
searched for the chosen pairs. The coverage check shows this before a
definition is saved, the Results header shows the coverage line on every
run, and per-cell verify is hidden. The spike (2026-10-14) found that a
thin long-haul destination can have **no** cached rows at all across eight
months while the busy gateways of the same country have four to six a
month, so a £0 definition may only be useful against gateways, with the
operator's own per-destination note ("onward leg not included") on those
rows.

**What $40 buys over £0:** thin routes that the free cache never sees,
fully priced calendars (126 of 126 cells on every probe), itinerary search on `maxCells`
cells per run with real segments, per-seller prices, baggage and constraint
verdicts, and a free 60-day route price history. On a subscription plan the
marginal cost per call is zero and the plan's 10,000 calls a month is the
hard stop; the worked example's weekly schedule uses well under a tenth
of them, and raising `maxCells` to ~200 per run or running daily both fit.
The exact figures are generated from the engine's own estimate functions
into `docs/scheduling.md` (§8.2).

**Non-goals for this build**: ground transport, rail, accommodation,
multimodal totals (§7 keeps two columns; the operator may enter an
onward-cost estimate shown as a separate "adjusted" sort, never folded into
a price); split-ticket optimisation; booking inside the app; multi-user;
price prediction; any provider not in §2 (the `camoufox` continuity fallback
in §2 is built as an opt-in provider, off by default).

---

## 2. Provider landscape and decisions (the gating constraint)

Researched 2026-10-14; full report with sources in `docs/providers.md`.

**There is no authorised, individually accessible, live fare API in late
2026.** Amadeus Self-Service was decommissioned on 2026-07-17. Duffel bans
metasearch and bills every search for a non-booking account. Kiwi,
Skyscanner, Trip.com and all GDS/NDC routes are closed to individuals.
Google has no public API.

| Provider | Nature | Cost | Role | `sourceKind` | `maxAgeHours` |
|---|---|---|---|---|---|
| Travelpayouts `/aviasales/v3/prices_for_dates` (`month` tiles: `departure_at=YYYY-MM`, `one_way=false`, no `return_at`; origin is always an airport code (a metro query returns one cheapest row per date pair across the whole metro and hides the definition's own fares, recorded 2026-10-15), rows attributed by `origin_airport`; paginated at 1000) | Authorised. Cached from Aviasales user searches, declared last 48h; **no** `found_at` on rows, but each row's `link` carries `search_date=DDMMYYYY` (the recordings show 4–7-day-old rows), which becomes `providerObservedAt`; `market` ignored; economy only; coverage of thin routes can be zero (spike) | Free, 600/min | Discovery baseline | `authorised-cached` | 48 |
| SearchApi `google_flights_calendar` | Scraping-derived aggregate of Google's date grid; ≤200 combinations per call (HTTP 400 above); per airport only (city codes rejected); entries `{departure, return, price, is_lowest_price}` in the request currency; 126/126 cells priced on every probed route including a thin one (spike); 9–29 s per call | trial 100 once; $40/10k per month | Discovery, opt-in | `scraped-aggregate` | 24 (the app's own conservative assumption, flagged as assumed and shown as "assumed ≤24h (undocumented)": a repeat call answered in 3 s and was not billed, so a vendor cache exists; its window is undocumented) |
| SearchApi `google_flights` | Scraping-derived itinerary search, three steps; some options carry no `price`; step 3 reveals OTA prices below the airline fare, so step 3 is always run (§5.4) | same plan | Verification, opt-in | `scraped-search` | `'unknown'` (the vendor may serve a cached answer of undocumented age, rev 15) |
| `camoufox`: Google Flights read by Camoufox (the pinned build `gmt setup` installs on the operator's machine) that a host-side worker launches itself through `camoufox-js` | Self-scraped by this app from the operator's own IP, in the worker's own signed-out profile; `list` mode reads one cell's cheapest round-trip total per page load from every result the page lists (structure seen in the feasibility load of 2026-10-18); `grid` mode (designed from the 2026-10-18 recordings, not built) reads up to 49 day pairs per view from the Dates tab's 7 × 7 grid; no return legs, flight numbers or sellers | £0 in money; the operator's IP and selector upkeep; the operator is responsible for how it is used | Discovery only, opt-in, off by default (continuity fallback) | `scraped-self` | 0 (the page as Google showed it when it was read) |

**Decision (Ian, 2026-10-14):** SearchApi is accepted as an opt-in provider,
on the understanding that its data is obtained in a way Google's terms
prohibit, one step removed from this app; the realistic risk is continuity
and the mitigation is the provider abstraction and labelling. SerpApi is not
integrated.

**Continuity fallback (Ian, 2026-10-14; built as an opt-in provider on
2026-10-18): the `camoufox` provider.** If SearchApi is withdrawn, re-priced
above the ceiling or loses Google's date grid, discovery can fall back to a
`FlightProvider` with id `'camoufox'` that reads Google Flights in Camoufox
(a Firefox-based browser that `gmt setup` installs on the operator's
machine), behind the
same contract, ledger, caps and labels as every other provider. It is **off
by default**: nothing runs until the operator starts the worker and sets
`CAMOUFOX_ENABLED=true` (§12, §13), and a definition must still name it.

*Method.* A host-side worker (`apps/camoufox-worker`, a Node process on the
operator's own machine, macOS or Linux; Windows is a later work package, and
the worker refuses to start there) launches its own Camoufox, always
headless (only the `consent` command below opens a visible window), with
`camoufox-js` 0.11.5 and `playwright-core` 1.59.1. The pinned build and its
archives come from one typed constant, `CAMOUFOX_BUILDS` in
`core/camoufox/builds.ts`, keyed by `<os>-<arch>` (`darwin-arm64`,
`darwin-x64`, `linux-arm64`, `linux-x64`): build `152.0.4-beta.28` for all
four (release `v152.0.4-beta.28` of `daijro/camoufox`, not a prerelease),
each entry holding its release asset's URL (only under
`https://github.com/daijro/camoufox/releases/download/`), its SHA-256 (equal
to GitHub's published digest, read 2026-10-19), its size and its unpacked
size. The worker's pin is its own entry's build; there is no separate build
setting. Only `gmt setup` and `gmt update` (§13) write the install root
`~/.local/share/get-me-there/camoufox/`: after checking free space against
the archive plus its unpacked size (313 MB and about 670 MB on macOS, 654 MB
and about 1.25 GB on Linux), they download the archive over HTTPS
(redirects followed only to `https` GitHub release-asset hosts), hash it
while streaming, refuse a mismatch, re-hash it just before unpacking, list
the archive and refuse any entry that is absolute, holds `..` or resolves
outside the target, unpack with `unzip` into a 0700 temporary directory
beside the target, write the bundle's `version.json` (`{ version, build,
release, sha256 }`, since neither archive carries one), and rename it into
`browsers/official/<build>-<first 8 hex of the sha256>/` in one step. The
CLI owns `camoufox-js`'s install-directory layout: on macOS, the install
root's `Camoufox.app` symlink to that bundle and its top-level
`version.json` in `{ version, release }` form; on Linux, where `camoufox-js`
expects `version.json`, `camoufox-bin`, `properties.json` and `fontconfig/`
directly in its install directory, the bundle directory itself is the
install directory. `update` installs a new pin only when that entry's
verification flags are set; otherwise it installs nothing, keeps the old
bundle and says the provider stays off on this `<os>-<arch>` until
recordings land. When it does install, it switches the layout after the
build step and removes the previous bundle only once the app is healthy. Nothing downloads at run time, and the
worker only verifies: `run.ts`, the worker's one `process.env` owner, refuses
an inherited `CAMOUFOX_INSTALL_DIR` and then sets it to its OS's install
directory before any entry can import `camoufox-js` (which reads it once, at
import); the launch module asserts the value before importing.
`ensureInstallLayout` checks the layout for its OS (on Linux a `version.json`
whose release `camoufox-js` accepts, `camoufox-bin`, `properties.json` and
`fontconfig/macos/fonts.conf`), never modifies anything, and refuses to start
when anything differs from the pinned entry: an empty or unsupported install
directory would send `camoufox-js` to its own download branch, which deletes
the directory first. On Linux the worker keeps `os: 'macos'` as on macOS and
writes a generated `fonts.conf` outside the bundle naming the bundle's
`fonts/macos/` by absolute path, passed as `FONTCONFIG_FILE` in the browser's
environment, because each bundled `fonts.conf` resolves fonts relative to the
process's working directory and `camoufox-js` 0.11.5 points
`FONTCONFIG_PATH` at a directory the bundle does not have; Linux also needs
Firefox's shared libraries, which `gmt setup`
checks (`ldd` over `camoufox-bin` and every `.so` in the bundle, `libxul.so`
included, as playwright-core's own host check does, reporting no missing
library) and names with their install line. The verification
flags live beside `CAMOUFOX_BUILDS` in `core/camoufox/builds.ts` (`FLAGS`,
read by the worker's selectors module and by the CLI), per `<os>-<arch>`,
each set bound to the build it was recorded under: a flag counts as true only while the running
build equals that set's build. `darwin-arm64`'s come from the 2026-10-18
recordings; the others stay false until a recording session under that
entry's build sets them, and until then the worker refuses to start there
(exit 78) naming the missing recording, `gmt setup` does not offer the
provider on that machine, and the app runs without it. The profile is a persistent directory
of the worker's own under its data directory, never shared and never seeded
from any cookie file; service workers are blocked (`serviceWorkers:
'block'`). The worker never calls the camofox-browser REST server, so that
server's automatic consent acceptance, shared access key, bootstrap cookies
and crash telemetry do not apply. The app's adapter calls the worker over
HTTP at `CAMOUFOX_WORKER_URL` (`http://127.0.0.1:8090` for `pnpm dev`,
`http://host.docker.internal:8090` for the app in Docker), sending
`CAMOUFOX_WORKER_KEY`; the app image carries no browser (§13). One worker
call makes at most one Google document load at
`https://www.google.com/travel/flights?q=Flights from <origin> to
<destination> on <depart> returning <return>&curr=GBP&hl=en-GB&gl=<POINT_OF_SALE>`,
the form the feasibility load used. Before reading, the worker checks the
page's own search form (round trip, one adult, departure and return dates)
against the query, and waits, polling the page through Playwright's locators within
`CAMOUFOX_PAGE_TIMEOUT_SECONDS`, until the page is settled (the "N results
returned." line is present and no node still reads "Fetching results").
Selectors are accessible roles and names, never CSS classes, in one dated
module. Option names are read from each result link through Playwright's
locators (the link's accessible name), never by parsing printed
accessibility text, and parsed by one dated grammar; a name the grammar
cannot read, or one longer than a generous limit, is counted as unparsed,
never silently dropped.

- **`list` (the only mode built):** one cell per page. Until a recording
  confirms the "Cheapest" tab's flow, the worker clicks nothing: it reads
  every result link on the page, parses each accessible name ("From 478
  British pounds round trip total. 1 stop flight with …"), keeps the options
  whose departure date and whose departure and arrival airports (matched to
  the queried codes through the airports dataset's names) are the cell's,
  and takes the minimum itself. An option whose name does not parse is
  dropped and counted (`offers-dropped:n`); options for another day or
  airport are counted on the cell as such; a "Cheapest from £X" tab price
  below the parsed minimum marks the cell partial. "View more flights" is
  clicked only once a recording shows it adds options below the visible
  minimum. A page Google shows as having no flights, recognised by its own
  grammar line once recorded, is `no_data`, never `empty`.
- **`grid` (designed from the 2026-10-18 recordings, not built; work package
  15, plan decision 70):** up to 49 cells per settled view. On a results page
  that has passed `list` mode's search-form and currency checks and settled
  on the Best view, the worker clicks the one "Price graph" button and, in
  the dialog "Price insights" that opens, the one "Dates" tab (both by exact
  name, observed 2026-10-18). The tab's `tabpanel "Dates"` holds an (empty)
  `grid "Date grid"`, a departures line naming seven days ("Thu 11 Mar" …
  "Wed 17 Mar"), 49 cell buttons in rows of one return date, a returns line
  ("Sun 21 Mar" … "Sat 27 Mar", then "Return"), the four buttons "Scroll
  left", "Scroll right", "Scroll up" and "Scroll down", and a line naming the
  selected pair with its year ("14 – 24 Mar 2027£462 · Round trip"). Cells are
  named like "£457, 11 Mar to 21 Mar", "£397, cheapest price, 15 Mar to 23
  Mar" or "£462, 14 Mar to 24 Mar, selected". The browser window is pinned
  at 1280 × 900 (camoufox-js's `window` option, from which the context
  measures its viewport; ordinary layout configuration, so the grid's size
  cannot follow a generated screen size); the grid side, 7, is the recorded
  one at that size.
  **The classifier inside the dialog.** On every poll the challenge,
  sign-in, signed-in control, consent, `SOCS` and allowlist checks run first,
  unchanged, and any of them stops the page with its cool-down. The
  results-page structure rules (the Cheapest tab count, the Date grid
  button, the result links) do not apply once the dialog is open: the 2026-10-18
  exploration read them as `unrecognised` (rule `cheapest-tab-count`) with
  the dialog open, because no dialog view existed. A dialog view,
  `dates-grid`, is recognised instead when the "Price insights" dialog is
  open, its "Dates" tab is selected and its panel holds the four scroll
  buttons; anything else is `unrecognised`.
  **Cells by name** (the `--grid` recordings of 2026-10-18: after a scroll
  the page reuses its elements and rotates their order, so position says
  nothing). The cell candidates are the panel's buttons other than the four
  scroll buttons, whatever their names; each name carries both of its dates,
  and the departures and returns lines are only a set check: the dates the
  cells name must equal the lines' sets. A view holds 49 cells less the pairs
  whose return precedes the departure (a same-day pair is shown; 39 near
  today in the recordings). **Cell grammar** (dated, observed 2026-10-18):
  `£<price>[, cheapest price | , low price], <d> <Mon> to <d> <Mon>[,
  selected]`, the price with thousands separators ("£1,308"), read through
  locators from each button's accessible name, never from printed
  accessibility text. A priced cell that parses and names
  its position's pair is kept; an unpriced cell is counted as `no_data` once a
  recording proves Google's unpriced form, and until then as unparsed, never
  guessed. Duplicate pairs, or names that fail the departures × returns
  cross-product, make the whole view structurally unparsed: nothing from it
  is stored, and its covered cells are issues. **Grammar drift:** when more
  than half of a view's priced-looking cells (names starting "£") fail the
  grammar, the page stops as `unrecognised` and no further scrolls run.
  **Years.** Each `<d> <Mon>` takes the year in {Y − 1, Y, Y + 1} (Y the
  query's) that puts it nearest the query's departure, and every weekday on
  both lines must agree with its computed date, else the view is
  `unrecognised`; so a view across 31 December rolls over. The selected-pair
  line ("14 – 24 Mar 2027", "28 Mar – 7 Apr 2027", "27 Dec 2026 – 6 Jan
  2027", or "20 – 23 Oct" in the current year) must name the query's pair;
  the first view's selected cell must be that pair, at the price line's price
  ("£462 · Round trip"), else `unrecognised`.
  **Stay range.** A block of departures `d…d+6` and returns `r…r+6` holds
  stays of `r − d − 6` to `r − d + 6` nights on its 13 diagonals. Blocks are
  laid on a lattice anchored at the later of the window's first departure and
  today (a re-plan of a window that has started never opens a view on days
  already past), and that date plus `minNights`: column `c` covers departures
  `7c…7c+6`, and its stays
  need returns `7c + minNights … 7c + 6 + maxNights`, which is
  `⌈(7 + maxNights − minNights) / 7⌉` blocks; so a pair needs
  `⌈D / 7⌉ × ⌈(7 + maxNights − minNights) / 7⌉` blocks. Cells inside a block
  but outside the definition's window or nights are ignored, never stored.
  **Scrolls.** The `--grid` recordings of 2026-10-18 measured the step: one
  scroll moves one day on its axis (left and right the departures, up and
  down the returns), revealing 7 new cells; the dated value (`stepDays` 1 and
  1) is reported by the worker in its status and passed to the planner. A
  block-to-block move is therefore 7 scrolls (about 65 s at the measured 9.3 s
  a scroll), while a new page opens a block directly in about 30 s (the page
  spacing; the first view is ready about 21–26 s after the load starts). The
  planner orders a pair's blocks in one path and chooses, move by move,
  between a new page and the scrolls, whichever is quicker within both the
  page and the scroll caps (the caps shared across the run's pairs); a move
  passes its intermediate views unread, and makes its later-return and
  earlier-departure scrolls first, so every view on the way holds round
  trips. A block of a 0-night stay on the diagonal would open on a same-day
  pair, which no page query is: its page opens a day later on the returns and
  scrolls up once before the block is read. It plans no block cell whose
  departure or return passes the sale window's horizon
  (`GRID_HORIZON_DAYS`, 320 days, dated 2026-10-18: a page 327 days out showed
  the no-flights page); one probe page covers those cells, opened at their
  least departure and least return. Pages hold at most
  `CAMOUFOX_GRID_SCROLL_CAP` scrolls (default 30, at most 60). Scroll clicks
  are at least `CAMOUFOX_GRID_SCROLL_SPACING_SECONDS` apart start to start
  (default 5, 0 to 30, fixed, never randomised; 0 means no pause, the scrolls go
  back to back). A run makes at most
  `CAMOUFOX_EXECUTION_SCROLL_CAP` scrolls (default 600) and a month at most
  `CAMOUFOX_MONTHLY_SCROLL_CAP` (default 6,000); the adapter asks the budget
  guard what the two caps leave, passes the page no more than that as its
  allowance and reserves that many, and the worker never scrolls past it: a
  page with no scroll left still reads its first block, and the blocks it did
  not reach are `error` (`parse`, `scroll-allowance`), resumable. The worker
  reports its scroll cap and spacing in its status, and the preflight skips
  the provider (`provider_disabled`, naming the setting) while they, or the
  page timeout, differ from the app's. A page whose first read view lies past
  its allowance (a 0-night lead scroll with none left) drops the lead scroll
  and reads the view it opens on.
  **Settles and deadlines.** The first view, after the Dates click, settles by
  the two-stable-polls rule. A view after a scroll counts only when its
  departures or returns line differs from the view before the move, and then
  holds stable across two polls at least 2 s apart. Every poll is classified.
  Each move has its own bounded budget (45 s for the click, settle and read,
  plus a 15 s reserve) inside the page's overall cap (the first view's page
  budget plus one move budget and spacing per planned move). A stop discards
  the whole page, the views already read included. A scroll that does not
  settle in its budget ends the page: the views read so far are kept, and the
  covered cells of the blocks not reached are `error` (`parse`, detail
  `page-not-ready`), resumable, with no cool-down. Google's no-flights line
  is generic and says nothing of cells the page never showed: on the probe
  page past the horizon (the grid-path request marked `probe`) it is the
  sale window's end, and every covered cell is `no_data`; on any other grid
  page only the query cell is `no_data`, and every other covered cell is
  `error` (`parse`, `no-flights-unseen`), resumable, with a note counting the
  no-data cells. A 0-night page with no scroll left, or under a per-page cap
  of 0, drops its lead scroll and reads the view it opens on. A pair read in two views of one page fails the tile (`parse`), and
  nothing from the page is stored.
  **Edges of the sale window.** The departures and returns lines are the
  source of truth for which dates a view shows. A first view shifted near
  today, or a short move at an edge, is accepted when its dates are
  consistent, and recorded as an "off-plan view" issue naming its cause
  (`near-today` when it starts at today or earlier, `sale-window-end` when the
  planned block reaches within a block of the horizon, else `shifted`), never
  as `unrecognised`; the page ends there and the resume re-plans the cells it
  did not read on the lattice anchored at today. A scroll that moves the
  other axis or the wrong way is `unrecognised`; a re-render that only
  reorders the labels is a scroll that did not settle.
  **Return date source:** grid prices take both dates from the cell, checked
  against the departures and returns lines; each stored row records where its
  return date came from (`return_date_source`, §7), the gate the earlier
  design set for enabling this mode.
  **Provenance:** source label "Google Flights date grid via Camoufox";
  `maxAgeHours` is the assumed 24 h, as for the SearchApi calendar ("Google's
  date grid; age not stated (assumed ≤24h)"), never 0: the grid is Google's
  own pre-aggregated summary, not a list read at that moment. The price is
  GBP, checked against the results page's "Currency GBP" control and each
  cell's `£`, and the grid shows whole pounds: pence are stored as pounds × 100
  and the note says so. Google's "cheapest price" mark is relative to the
  prices shown in that view (the panel's legend: "Cheapest Compared with
  other prices shown") and is stored as the vendor's flag
  (`vendor_price_mark` ∈ `cheapest | low | none`; the grid also marks "low
  price"), never taken as this app's own minimum; SearchApi's
  `google_flights_calendar` `is_lowest_price` fills the same field
  (`cheapest` or `none`).

Cell keys and currency come from the page; in `list` mode the return date
is the date the worker asked for (the page's options state only the
departure), checked against the search form and labelled so; in `grid` mode
both dates are the cell's own, checked against the grid's header and footer.

*Capabilities: discovery only.* Each page yields one price per (departure,
return) pair, which is exactly a `RawCalendarPrice`. Itinerary search is not
offered: a result's accessible name states the outbound only (airline names,
airport names rather than codes, local times, stops, duration) and a
round-trip total, with no return leg and no flight numbers, so a `RawOffer`
could not be built without inventing fields, and no seller can be reached
inside the allowlist (`RawOffer.verified`). Its prices are calendar basis
(§6.9): "constraints not checked", with the search link.

*Limits (operator rulings of 2026-10-18, plan decisions 68 and 69).* Camoufox
is the browser as the operator installed it; the worker adds no
humanised input, no geolocation lookup and no add-on, and passes the browser
a minimal environment (never the worker's own secrets). **The worker's own,
signed-out profile:** it refuses to start, and stops before any page, when
the profile holds a Google account cookie: any cookie on a `google.com`
domain (both `www.google.com` and `accounts.google.com`, read together with
`context.cookies()`) named in the dated set `SID`, `HSID`, `SSID`, `APISID`,
`SAPISID`, `__Secure-1PSID`, `__Secure-3PSID`, `__Secure-1PAPISID`,
`__Secure-3PAPISID`, `__Secure-1PSIDTS`, `__Secure-3PSIDTS`,
`__Secure-1PSIDCC`, `__Secure-3PSIDCC`, `SIDCC`, `LSID`, `__Host-1PLSID`,
`__Host-3PLSID`, `__Host-GAPS`, `OSID`, `__Secure-OSID`, `ACCOUNT_CHOOSER`,
or any cookie at all on `accounts.google.com`; a page showing a signed-in account control ("Google
Account: …") is `blocked`, page `signed-in`, and the worker refuses to serve
until the operator clears a persisted flag after wiping the profile. **No
proxies** of any kind: every page comes from the operator's own IP address.
**No challenge is ever solved or bypassed**: no CAPTCHA solver, no clicking a
challenge, no waiting a challenge out. One page at a time (concurrency 1), at
least `CAMOUFOX_MIN_SPACING_SECONDS` (default 30, 0 to 600, never
randomised) from the **start** of one page load to the start of the next. The
app's limiter takes that spacing directly as its minimum interval between
starts; the worker enforces the same spacing with a fixed 2 s tolerance for
arrival jitter. The last page time is persisted, so a restart keeps the
spacing. A value of 0 means no pause: pages go back to back, from your own
address, still one at a time, with no rate limit beyond the page caps. At most
`CAMOUFOX_EXECUTION_PAGE_CAP` page loads per execution (default 100, at most
400; frozen into the execution's budget snapshot at creation) and
`CAMOUFOX_MONTHLY_PAGE_CAP` per month (default 1,500).

*Caps across callers.* The worker enforces `CAMOUFOX_MONTHLY_PAGE_CAP` and
`CAMOUFOX_MONTHLY_SCROLL_CAP` itself, for every caller together, over the
ledger's own window: the month starting at 00:00 UTC on
`CAMOUFOX_BILLING_DAY` (§7 "Budget windows"), computed by one pure function
in `core` that the `db` window query is tested to agree with. The caps and
the billing day are shared settings (§12), so the app's ledger and the
worker count the same month against the same numbers. Under the default
`CAMOUFOX_BROWSER_WINDOW=scheduled`, pages also load only inside a run's
browser window (§8.2). The worker keeps the
window's page and scroll counts in their own 0600 file beside its pacer's
last-page time and counts every page it loads (the adapter's, the `consent`
command's, `consent check`'s and the `consent-research` recorder's). Under
its lock, before loading anything, it admits a page only while the page cap
has room (a page past it is refused with the reason `monthly-cap`, which the
adapter maps to `BudgetExceeded` at `provider-month`); it clamps a grid
page's scroll allowance to what the monthly scroll cap leaves, so a page with
no monthly scroll left still reads its first block and a page that reaches
the clamp ends as `allowance` with the views it read kept and its row's
`scroll_count` equal to the scrolls made; and it writes the page and its
clamped allowance into the counts file before the load, settling to the
scrolls made afterwards, so a crash over-counts and never under-counts. An
absent counts file starts the window at zero only when the worker has never
loaded a page (no pacer file either); a counts file that is unreadable,
invalid, from a widened mode, or missing beside an existing pacer file
refuses every page with `monthly-cap` and is never overwritten with zeros.
`/v1/status` reports the counts and the window. A second app instance
calling the worker in one window is reported in the Status view, not
refused.

*Consent: rejected, never accepted.* A fresh signed-out profile lands on
Google's consent page ("Before you continue", "Reject all" / "Accept all";
signed-out test, 2026-10-18). The worker never clicks anything on it. Before
the profile's first navigation and before every page it sets Google's
consent-choice cookie `SOCS` (named in Google's cookie policy as the cookie
that "store[s] a user's state regarding their cookies choices", read
2026-10-18) to the operator's captured **rejection** value with
`context.addCookies`. Google does not document the value, so the operator
captures it from a real "Reject all" with `gmt consent` (§13), which stops
the worker service, runs the worker's `consent` command, and afterwards
starts the worker when the capture succeeded (clearing any `consent-*` start
refusal) or restores its previous state otherwise. The command holds the
worker's lock and runs under its pacer and cool-downs: it refuses during a
cool-down, naming its end, waits out the page spacing from the persisted
last-page time and writes that time after its one load, which the monthly
page count includes. It opens a visible Camoufox window in a new throwaway
profile on the landing page `https://www.google.com/travel/flights?hl=en-GB&gl=<POINT_OF_SALE>`;
on Linux it alone receives the display variables `gmt consent` passes
through, as two groups, `DISPLAY` with `XAUTHORITY` when `DISPLAY` is set and
`WAYLAND_DISPLAY` with `XDG_RUNTIME_DIR` when `WAYLAND_DISPLAY` is set (never
`DBUS_SESSION_BUS_ADDRESS`), and it refuses, pointing at export and import,
when neither is set. It prints "Click **Reject all** in the window. Nothing
else is needed; close the window when you're done", and never clicks, types,
navigates after that one load or evaluates script. Its guard is the
recorder's consent-probe guard widened by exactly document navigations and
form POSTs to `consent.google.com` (its `/save` included) and the redirect to
`www.google.com/travel/flights`; every other host is refused as on the server
path, and the server path never admits `/save`. It observes read-only: the
main frame's URL host on every navigation, the classifier's view on a
snapshot, and `SOCS` by name and domain from `context.cookies()`, every other
cookie dropped as it is read; a Google account cookie appearing (the worker's
own set) fails the capture. When `SOCS` appears after the consent host was
seen, it reads the value, domain, path, expiry, `secure` and `sameSite`,
checks them with the parser `capture-socs` uses, computes the rejection mark
from the value with the function work package 17's two throwaway recordings
(one "Reject all", one "Accept all") establish, and writes the file 0600
with the capture time only when that mark says rejection. An acceptance,
`SOCS` with no consent host seen, a consent page left unclicked for 10
minutes, a challenge page, a page that never loads, a first view the
classifier does not positively recognise, or a closed window writes nothing
and says which. The command is built only once those recordings prove a
mark computed from the value alone; until then `capture-socs` stays the way
to record the choice. The throwaway profile is deleted in a `finally` (the
recorder's start-up sweep removes any left by a killed run). Where the first
stable view is the landing view, a page kind the classifier recognises
positively from its own dated selectors (`LANDING_VERIFIED`, set by the same
recordings), no consent host was seen and no `SOCS` is set (a region with no
consent screen), the command asks the operator to confirm and writes the
record `{ consent: "not-shown", checkedAt }` at once. On a machine with no
display there are two paths. `gmt consent export`, on a Mac or Linux desktop
where `gmt setup` has installed the pinned Camoufox (it never installs one
itself), runs the same capture and prints one line, `gmt-socs-v1.` followed by
the base64url of the `SOCS` fields, `capturedAt` and the mark, as its only
standard output; `gmt consent import` on the server reads that line from
standard input only (at most 4 KB; an argument is refused), checks it with a
strict schema (name exactly `SOCS`, the value's length and characters
bounded, domain `.google.com`, path `/`, expiry no later than 13 months after
`capturedAt`), recomputes the mark from the value and refuses a line whose
carried mark differs or is not a rejection, and writes the same file, keeping
`capturedAt`. `capture-socs`, the paste from an ordinary private window, is
the lighter equal option. A server in a region with no consent screen uses
`gmt consent check`: one headless load of the same landing page under every
worker rule (the lock, the pacer and its monthly count, the guard, the
classifier, the cool-downs), read-only, at most once an hour (the last
check's time is persisted beside the pacer's last-page time, so a new process
is refused before then with the time it may run), which writes the not-shown record only under
the rule above and otherwise says that this server's region shows a consent
screen and to capture on a desktop. With a not-shown record the worker sets
no cookie, and a consent page at any step, or a `SOCS` cookie appearing after
a page, stops it as `consent-unhandled` like any other and rewrites the
record as `{ consent: "voided", voidedAt }`: `/v1/status` then reports kind
`voided`, the worker refuses its next start with the reason `consent-voided`,
and the Status view's consent check fails ("consent screen now shown: capture
again"). A capture's expiry is the earlier of the cookie's own expiry and
`capturedAt` plus 13 months (a not-shown record's is `checkedAt` plus 13
months), and the summary says which bounds it (`boundedBy` `cookie`,
`capture` or, for a not-shown record, `check`; null once voided); `gmt status` and the Status
view (§11) warn from 30 days (as elapsed time) before it and fail after it,
and the app sends one operator email a day while that check is not `ok`
(§8.3); the worker refuses to start
without a capture, or with one older than 13 months (the cookie's stated
lifetime) or dated in the future. After every page, on every path, success
and failure alike, the worker reads `SOCS` back with `context.cookies()` and
**compares the value**: a consent page at any step, or a `SOCS` value changed
or missing after a page, is **`blocked`, page `consent-unhandled`**: the
worker closes the context, wipes the profile and cools down. The recordings
(below) prove, in throwaway profiles, that a pre-set rejection keeps the
consent page away and that Google leaves the value unchanged across pages;
if Google turns out to rewrite it, the operator rules on that with the
recording, and the comparison is never weakened in the meantime.

*Navigation and the stops.* The worker opens only the URL form above and
clicks only names in its selectors module (none until a recording verifies
them). Every navigation is guarded twice: `context.route` aborts any
document or frame request outside `https://www.google.com/travel/flights…`
(it sees a redirect's first URL only), and a `framenavigated` and `request`
guard checks every navigation's final URL, redirect hops included, so a
302 to another host stops the page however it arrived. A navigation to
`consent.google.com` is `consent-unhandled`, to `accounts.google.com`
`sign-in`, and anywhere else `off-allowlist`. (Subresources load as in any
browser; the browser's own background connections are observed in the
launch smoke and its telemetry, crash-report, Normandy and captive-portal
services are switched off by preference.) A CAPTCHA is detected by a
reCAPTCHA frame URL or the page's challenge text, never by an element name. The worker classifies the page on
every snapshot, blocked kinds first. On a CAPTCHA (a reCAPTCHA frame or
checkbox), an "unusual traffic" page (`/sorry/`), a sign-in wall, a
signed-in control, a consent page or an off-allowlist navigation it **stops
at once** and cools down for `CAMOUFOX_COOLDOWN_HOURS` (default 48,
configurable, at least 24). A page it cannot recognise (a layout change, a
search form that disagrees with the query) stops it too, for a fixed **1
hour**: a page change is not a challenge page. In short, the worker stops and
cools down whenever a page is not a recognised results page: a challenge or
verification page, a sign-in page, a consent page, or anything unrecognised.
Either way the cell outcome is
`error` with reason `blocked` (a `ProviderError` of kind `blocked`, never
retried; the page kind, worded distinctly, goes to `last_error`), the
provider is disabled for the rest of that execution (including a manual
resume of it), and the cool-down survives a worker restart. A page that does
not settle within the page timeout is an `error` (`parse`, detail
`page-not-ready`) with no cool-down; two in a row disable the provider for
the run, as any parse streak does. Before planning camoufox tiles, the engine
reads the worker's `/v1/status` (an unledgered call): during a cool-down, or
with the worker unreachable, the provider's cells are skipped with no ledger
rows (`skipped:provider_disabled` "cooling down until <time>", or
`skipped:provider_unavailable` "browser worker not reachable"), and the
operator is notified once per cool-down, never once per run. A connection
the worker refuses mid-run is `provider-unavailable`: not retried, and the
first one disables camoufox for the rest of the execution while other
providers continue.

*Recordings first.* Before any parser depends on Google's page, the
operator records, in this order: (1) the `SOCS` capture from an ordinary
private window; (2) with `SOCS` pre-set, the results, Cheapest and View-more
pages, each landing on `www.google.com/travel/flights` (the evidence that the
pre-set rejection keeps the consent page away), and three spaced pages whose
`SOCS` read-back stays equal; (3) a consent probe in a throwaway profile, the
one of the two narrow navigation exceptions (the other is the `consent`
command above), which lives only in the recorder, records
the consent page, clicks nothing, starts no cool-down and deletes its profile
in a `finally` (a start-up sweep removes any left by a killed run); (4) a "no
flights" page, from a valid query the operator picks at recording time for a
pair or date with no service, or a record that none appeared, in which case
the no-flights line stays unverified. For each further `<os>-<arch>`
entry the operator repeats (2) and (4), and the `--grid` pages, under that
entry's build, and the session sets that entry's flags only (work package
17): `darwin-x64` on the operator's Mac under Rosetta, `linux-arm64` in a
Linux arm64 container on the same Mac and `linux-x64` in a Linux x64
container under emulation, all headless with the generated `fonts.conf`, so
every load comes from the operator's own address like every other recording.
The containers mount only the source paths the recorder needs, never `.env`,
`data/` or any settings file. Work package 17 also records, in throwaway
profiles, headed, with the person clicking and under the `consent`
command's guard above, one "Reject all" and one "Accept all" capture,
storing the two `SOCS` cookies' fields and the consent form submission's
request path and field names (never a value beyond the one that tells the
two apart), which settles the rejection mark.

*Ledger and caps.* Every worker call through the adapter is one
`provider_requests` row under the **free-provider rules** (never billable,
cost 0, never cached; engine reuse, §8.1, is the only reuse). The worker
states on every answer whether Google was contacted; a row whose answer
contacted no Google page (spacing 429, cooling-down 423, mode-unavailable
409, 400, 401, a 5xx before navigation, a refused connection) carries the
outcome class `no-page`, and the page caps (`provider-month` and
`provider-execution` for camoufox) and every "pages" figure count only the
other rows. `provider-execution` is checked after `provider-month` and before
`execution-free-calls`, which camoufox page rows also draw on. Transport
failures after the request was sent (a timeout, a dropped socket) are never
retried for camoufox, so one tile never costs two Google loads. In `grid`
mode a scroll is not a page load: a page's row carries `scroll_count`, the
scroll clicks it made (every answer to a grid request that reached Google
carries them, a stop included; a timeout or an abort after the request left,
outcome `unknown`, keeps the planned scrolls the reservation held, so the
scroll caps never undercount; a refused connection, a `no-page` row, leaves
it NULL), the page caps count rows, and the scroll caps count
`scroll_count`. A scroll-cap breach is worded as one ("camoufox's scroll cap
for this run is 600 scrolls; …").

*Labels.* Display name "Google Flights via Camoufox"; source label "Google
Flights prices via Camoufox"; compact mark `CF`. `provenanceNote`: "Google
Flights prices via Camoufox: the cheapest round-trip price Google Flights
listed for this day pair when this app's own Camoufox browser read the page
on the machine running this app's browser worker, from that machine's address, in the currency
the page states. Return date: the date asked for, which the page's search
form showed; the listed options state only the departure. The operator turned
this provider on. Constraints are not checked; no return
leg, seller or baggage is read."  In `grid` mode the source label is "Google
Flights date grid via Camoufox" and the note reads: "Google Flights date
grid via Camoufox: the round-trip price Google's date grid showed for this
day pair when this app's own Camoufox browser read the page on the
machine running this app's browser worker, from that machine's address. The grid shows whole
pounds; the exact fare may differ by under £1. Google's date grid; age not
stated (assumed ≤24h). Return date: read from the grid cell, checked against
the grid's return row. A "cheapest" mark means Google's date grid marked
this the cheapest of the prices shown in that view; it is Google's, not this
app's. The operator turned this provider on. Constraints are not checked; no
return leg, seller or baggage is read." Vendor links: `google.com` only.
`pointOfSale` is the ISO country of the page's stated location, through a
dated table, or `'unknown'` when the page states none; it is stored as
stated, so a page that ignored `gl` never passes for the requested market.

*Coverage, stated plainly.* In `list` mode a page prices one day pair, so a
run prices at most `CAMOUFOX_EXECUTION_PAGE_CAP` day pairs and a month at
most `CAMOUFOX_MONTHLY_PAGE_CAP`: with the defaults, 100 a run and 1,500 a
month, against 2,184 day pairs for one worked-example airport pair (8,736 for
its four pairs). The estimate says how many cells a run will price and how
many runs a full pass takes; the rest of the cells read skipped or not
searched in View D. The `grid` mode changes the arithmetic: 7 × 7
blocks laid over a 12-night band need `⌈182 / 7⌉ × ⌈18 / 7⌉ = 26 × 3 = 78`
blocks a pair (3,822 grid cells, of which the 2,184 in the band are stored,
57%), 312 for the four pairs. At the measured one-day step a block-to-block
move is 7 scrolls (about 65 s) against about 30 s for a new page, so the
planner opens pages until the page cap binds and scrolls only past it, each
pair within its share of the caps (25 pages and 150 scrolls of the defaults'
100 and 600 for four pairs), with the pages that join blocks first. The engine
takes the pairs' grid pages in turn up to the page cap (list mode and every
other provider keep each pair's tiles together), so with the defaults the
run's estimate is 100 pages and 588 scrolls, about 2.4 hours, reading 5,152 of the 8,736 day pairs, and a full
pass takes 3 runs; with `CAMOUFOX_EXECUTION_PAGE_CAP` raised to 312 it is one
run of 312 pages and no scrolls, about 2.6 hours. A scroll takes the measured
9.3 s or the configured spacing when that is longer, and the estimate says
when a run would pass `STUCK_AFTER_HOURS`; `budgetFit` warns when a month's
scrolls pass the monthly scroll cap. `list` mode needs 8,736 pages for the
same pass.

*Costs, stated plainly.* **Terms:** Read the provider's terms before enabling
it; the operator is responsible for how it is used. **The operator's IP and account:** every page
load comes from the operator's own address (no proxies), so a block, CAPTCHA
or wider restriction lands on that address, and through it on the operator's
other Google use from the same network; the worker's profile is never signed
in, so the operator's account is never used. On a server (a VPS, or any
machine with no display), page loads come from that server's address, not a
home connection. `gmt setup` shows this summary of costs on every machine
before it asks about the provider, and on a machine with no display adds,
and requires a typed `yes` for (`acceptServerAddress: true` in an answers
file): "Page loads will come from this server's address, not a home
connection. A datacentre address is more likely to be refused or shown a
verification page, and each one pauses the provider for 48 hours; any
restriction applies to that address. If that is not acceptable, leave the
provider off, or run the app on a machine at home." **Brittleness:** Google changes
the page without notice; a changed page reads as unrecognised and stops the
provider for an hour (never a silent zero), and the selectors and grammar
must be re-dated against a new recording; `camoufox-js` is marked
experimental by its authors, and an upgrade of it, of `playwright-core` or of
the Camoufox binary is a re-verification. **Speed:** a page takes about 20–60
s (load, settle, read) plus the 30 s spacing, about 50–90 s in all, so 100
cells a run take about 1½–2½ hours; in the designed `grid` mode a page opens a
block in about 30 s and each scroll takes about 9.3 s (measured 2026-10-18),
so a page with its full 30 scrolls takes about 5 minutes, and about 30
minutes at the maximums (60 scrolls, 30 s spacing). **Availability:** the provider runs only
while the operator's machine is on and the worker is running; otherwise its
cells read skipped ("browser worker not reachable") and every other provider
runs. **Image size:** none in the app image, which is unchanged; Camoufox
(313 MB to download and about 670 MB unpacked on macOS, 654 MB and about
1.25 GB on Linux) and the worker's dependencies live on the
operator's machine. **The worker key:** any process or container that can reach
the worker's address (Docker Desktop forwards `host.docker.internal` to the
Mac's loopback for every container) is stopped only by
`CAMOUFOX_WORKER_KEY`. **Money:** none, against SearchApi's ~£32 a month.

**Consequences baked into the design:**

- `sourceKind` and `maxAgeHours` are declared per capability and stamped on
  every stored price row. Every price carries `fetchedAt` (set by http-kit,
  the original `storedAt` on a cache hit, the **oldest** call of a
  multi-step chain) and `providerObservedAt` only when the vendor states
  it. Nothing is defaulted.
- The engine's cells are `(origin, destination)` airport pairs from the
  definition. SearchApi is queried per airport pair (it rejects city
  codes). Travelpayouts is queried per (origin, destination, month) by
  airport code, never by metro code (a metro query returns one cheapest
  row per date pair across the whole metro, hiding the definition's own
  airports' fares), with rows attributed by their `origin_airport` field,
  which the spike proved is always present; rows for airports outside the definition are
  dropped. No airport, city or country is named in application code. `point_of_sale` is `'unknown'` for Travelpayouts because the
  `market` parameter is ignored, and `'GB'` for SearchApi, which echoes
  `gl=gb`.
- Adapters return raw vendor shapes: native currency **read from the
  response** (a response that states no currency is a `parse` error unless
  a recorded fixture proves the vendor's convention), vendor times, vendor
  links. The engine normalises.
- The app runs with zero, one or both providers.
- Synthetic data exists only behind the gates in §5.5.

**Spike results (2026-10-14; the full record and redacted fixtures are
kept privately by the operator outside the repository, and WP4b re-records
equivalent fixtures on the public example route).** Eleven SearchApi trial
calls and ~175 free Travelpayouts calls settled every open fact:

1. Travelpayouts: airport attribution proven (`origin_airport` on every
   row); `currency=gbp` honoured; `market` ignored (point of sale unknown);
   `trip_class` ignored (economy only); no `found_at` on
   `prices_for_dates` rows; coverage on a thin long-haul route zero to two
   rows over eight months, on busy gateways four to six a month;
   `grouped_prices` unusable with a nights band; tiling is one
   `prices_for_dates` call per (origin airport, destination, month). A
   metro-code query (`LON`) returns one cheapest row per date pair across
   the metro, so a cheaper non-definition airport hides the definition's
   fare (recorded 2026-10-15); metro queries are not used.
2. SearchApi calendar: 200-combination limit enforced as HTTP 400; per
   airport only; every probed route fully priced, thin ones included; 9–29 s
   latency; 21 rectangles per pair for the worked example's 10–21-night band
   and 182-day window (9 outbound days × the 20-day return span the band
   needs; 180 combinations).
3. SearchApi chain: step-1 price equals the step-2 price for the cheapest
   pairing (£603); step 3 showed an OTA at £573, so **the parity assertion
   fails** and `bookingLinks` is forced on (§5.4). Two of nine step-1
   options and one of three step-2 options carried no price.
4. SearchApi caching: a repeat call answered in 3 s with a new search id.
   The dashboard read **91 remaining of 100** after eleven HTTP 200 calls,
   one HTTP 400 and one HTTP 401, so at most nine were billed: error
   responses are not billed and the cached repeat was not. The ledger
   still counts every HTTP 200 attempt against the call cap (it may
   overcount the vendor, never undercount), and `SEARCHAPI_CACHE_TTL_HOURS`
   stays 1 as the local cache window; the vendor's window is undocumented.
5. Error bodies recorded: SearchApi 401 `{"error":"Invalid API key."}` and
   400 with a descriptive message; Travelpayouts 401 plain `Unauthorized`.
   No 429 or quota body observed yet; the adapters map those by status and
   ledger state until one is recorded.
6. Carriers: both providers returned the relevant national and
   connecting carriers for the probed country pair.
7. The dashboard labels the allowance "Remaining free searches (credits)":
   a one-off credit balance, not a recurring monthly allowance, so the
   `trial` plan uses a **lifetime** window and the £0 configuration is
   Travelpayouts-only. Ian is subscribing to the $40 plan (2026-10-14).
8. Both vendors accept the key in a header (`Authorization: Bearer`,
   `X-Access-Token`); no key is ever sent in a URL.

A bonus: `google_flights` step 1 returns `price_insights.price_history`, a
60-day daily series of the route's lowest price, stored on every
verification as a free history source (§7 `route_price_history`).

---

## 3. Core concepts and vocabulary

- **Search definition** — the operator's intent: origins, destinations,
  window (absolute or **relative**), nights range, cabin, constraints,
  verification policy, budget, providers, optional schedule, optional
  standing cost confirmation, optional onward-cost estimates.
- **Cell** — `(origin, destination, departureDate, returnDate)`. The atomic
  unit of coverage. The **search space** is resolved at execution start.
- **Search execution** — one run over a resolved space with a definition
  snapshot, stages, seeded per-cell-per-provider outcomes, an estimate and
  a ledger. Resumable. A **child execution** verifies one cell on demand.
- **Discovery** — stage 1, calendar prices, no verdicts.
- **Verification** — stage 2, itinerary search for selected cells.
- **Itinerary** — the flights; identity by canonical hash (§6.4).
- **Fare offer** — `(itinerary, provider, seller, cabin)`.
- **Price observation** — an offer seen at a moment, with the constraint
  inputs that were available (`supplied_fields_json`); verdicts are
  recomputed at read time.
- **Cell outcome** — per `(execution, cell, stage, provider)`: status
  `not_run | priced | empty | no_data | error | skipped`, `reason`,
  `attempts` (engine passes), `fetched_at`, `min_pence`, `cabin`,
  `point_of_sale`, `source_kind` (so reuse can match outcomes that have no
  price row), `reused_from_execution_id` (always the execution that fetched
  the price).
  Seeded `not_run` at start for every cell × discovery provider, and at
  selection time for every cell × verification provider (non-selected →
  `skipped:not_selected`). A stage with **no provider configured has no
  outcome rows and a `NULL` roll-up** (`not_applicable` in the API).
  - `priced`: the provider returned a price for exactly this cell, and at
    least one price or offer was written. Note `partial-expansion` when
    some expansions failed; note `offers-dropped:n` when offers could not
    be normalised.
  - `empty`: positive "no fares" for this cell.
  - `no_data`: the call covered the cell but had nothing cached or computed.
    Not evidence that no flights exist. Also, with reason `cabin-not-offered`,
    every cell of a provider whose `cabins` excludes the definition's cabin;
    no call is made and parity is unaffected.
  - `error`: `reason` is the `ProviderError.kind` (including `blocked`,
    the `camoufox` provider's hard stop on a page that is not a recognised results
    page, §2), or `fx-unavailable`,
    `currency-unsupported`, `unknown-airport-tz`, `no-return-legs`,
    `no-priced-options`, `unmappable-carrier`; the vendor's message,
    URL-stripped, is in `last_error`, never in `reason`.
  - `skipped`: `reason ∈ not_selected | budget | provider_disabled | provider_unavailable | scheduled_only | departed` (`provider_unavailable`: the `camoufox` worker could not be reached, §2; `scheduled_only`: a `camoufox` cell left for a later run, with a detail code in `cell_outcomes.skip_detail` (migration 0007): `catch-up-no-browser`, a catch-up's cell that reuse did not fill, shown "…: a catch-up loads no browser pages", or `outside-browser-window`, a cell a run reached past its browser window, shown "…: outside this run's browser window" (§8.2); the words before the colon name who fetches it, read when it is shown: "left for the next scheduled run" only when the definition is scheduled and enabled and its scheduled runs still use the browser provider (configured and enabled), "left for your next run of this search" when only a run started by hand would, else "not fetched: this search no longer uses the browser provider" (`core`'s `leftForOf` and `scheduledOnlyText`, one text for View D, the cell panel, the notice and the Status view; the engine's `browserLeftFor` answers it and the api returns it as `browserLeftFor`); the promise is made only for the latest parent run's cells, and an earlier run's left cell reads in the past tense, "left by that run: <why>").
  - Coverage is always shown as **six buckets**: priced, no fares (`empty`),
    no cached data (`no_data`), error, skipped (reasons in the drill-down),
    not searched (`not_run`); they sum to the cell count. "Searched" as an
    umbrella (`priced + empty + no_data`) appears only in View D beside the
    breakdown. Reused outcomes count in their bucket and the header adds
    "(R reused from earlier runs)".
  - A cell interrupted mid-flight returns to `not_run`.
- **Cell roll-up** — §6.6 precedence, stored, recomputed with every write.
- **Verdict** — `pass | fail | unverified`; **class** `verified` (all pass),
  `partially-verified`, `failed`; calendar prices are `unchecked`. The word
  "verified" is reserved for the class. Stage counts use
  **"itinerary-searched"**.
- **Provenance** — `{ providerId, sourceKind, fetchedAt, providerObservedAt?, maxAgeHours: number | 'unknown', fx: { converted: false } | { converted: true; rateNano; rateDate; source }, pointOfSale: PointOfSale, cabin }`, where `PointOfSale` is the ISO 3166-1 alpha-2 code the vendor echoes for `POINT_OF_SALE`, or `'unknown'`.
- **Effective age** — `providerObservedAt` age if present; else `fetchedAt`
  age + `maxAgeHours`; else (`'unknown'`) the `fetchedAt` age alone, labelled
  "vendor's cache age unknown" and never marked stale on that account (a
  price is stale only when its known age exceeds the threshold). Two label formats are defined once in `core`: the full form
  "fetched 2h ago · provider age unknown (≤7d before that)" for tooltips,
  headers and email, and the compact row form "2h ago · ≤7d" for table
  cells; where even that does not fit (a calendar day, the phone face) the
  short face form "5d old", "≤2d old" or "age unknown", also from `core`.

---

## 4. Architecture

Single Node process (API + engine + scheduler) serving a built React SPA and
one SQLite file, run either natively as a user service, the default local path
that the `gmt` command sets up on macOS and Linux (§13), or in one container,
the VPS path. Optional Mailpit for local email.

| Package | May import | Owns |
|---|---|---|
| `core` | `zod`, `@noble/hashes`, `@date-fns/tz` (instants and DST; calendar dates stay epoch-day integers) | Types; ports `FlightProvider`, `BudgetGuard`, `ResponseCache`, `Notifier`, `Logger`, `Clock`; errors; the config zod schema (pure) and `syntheticAllowed`; `api-contract`; every §6 function; the label formatter. 100% coverage. |
| `db` | `core` | Schema, migrations, repositories; `BudgetGuard`, `ResponseCache` implementations; airport and FX repositories; `app_lock`; seed. |
| `providers` | `core` | Adapters (raw shapes); `createHttpKit({ budget, cache, limits, clock, log })` over `globalThis.fetch`; the fixture provider, which is an ordinary HTTP adapter against `http://fixture.local` (served by `msw` in tests and, in fixture mode, by an in-process router that http-kit dispatches to for that one hostname, a seam gated by `syntheticAllowed`). No SQLite, no `process.env`. |
| `engine` | `core`, `db`, `providers` | Orchestrator, normalisation step (calls db repositories directly), stage runners, scheduler (owns the single `parseCron` wrapper over `croner`, which `api` imports for validation), notifiers, alert runner, FX refresh (through http-kit under the never-billable id `fx`), maintenance job. |
| `api` | all | Two entrypoints: the **app bootstrap** and the **tool bootstrap** (§7), both built on the wiring helper from WP4b and parsing `process.env` once through the `core` schema. Routes incl. the authenticated `/tools/*` routes, auth, hardening, static, health. |
| `web` | `core` (types, `api-contract`, pure filter/rank/verdict/label functions) | SPA. |
| `camoufox-worker` (`apps/camoufox-worker`) | `core` | The opt-in browser worker (§2): its own process on the operator's machine; `camoufox-js` and `playwright-core` only in its launch and driver modules. |
| `cli` (`apps/cli`) | `core` | The `gmt` command (§13): setup wizard, service management behind one `Platform` interface, the Camoufox install from the manifest, the consent and status front ends, update and uninstall. Reaches the app and the worker only over HTTP or as child processes (`pnpm --filter … <command>`), never by import; no browser library; `process.env` read only in its entry module. |

**Tech**: TypeScript strict, Node 22, pnpm, `better-sqlite3` + Drizzle,
Hono + `@hono/node-server`, `zod`, `@noble/hashes`,
`@date-fns/tz`, `bottleneck`, `p-retry`, `pino`, `croner`, `nodemailer`,
Vite + React 19 + TanStack Query + TanStack Table + Tailwind + Recharts,
Vitest + `msw` + Testing Library + Stryker, Playwright, Biome.

**Integration notes to verify at plan time** (each brief links its source):
`@hono/node-server` `serveStatic` SPA fallback; `better-sqlite3` prebuilt
fetch made **fail-closed** (no source-build fallback; version pinned by
lockfile; integrity recorded in the WP12 brief); pnpm 12
`allowBuilds` for `better-sqlite3` and `esbuild`; Drizzle migrations in the
image; `croner` `timezone` and one-shot jobs; `msw` on global `fetch`;
`bottleneck` chained reservoirs + `maxConcurrent`; `p-retry`
`onFailedAttempt` with `Retry-After`; `@date-fns/tz` `TZDate` DST rules;
synchronous `better-sqlite3` transactions.

**Auth and request hardening** (`api`):

- Basic auth, both vars or neither, minimum password length 12, constant-time
  compare, failed-auth rate limit (5 per minute per source IP, taken from
  `X-Forwarded-For` only when `TRUST_PROXY=true`, with a global fallback of
  20 per minute); covers everything except the minimal unauthenticated
  `GET /health`, which is also exempt from the Host allowlist.
- Unauthenticated on a non-loopback bind refuses boot unless
  `ALLOW_UNAUTHENTICATED=true` (Tailscale-only hosts). The container binds
  `0.0.0.0`, compose publishes `127.0.0.1:3000`, so **compose requires
  auth**; `docs/setup.md` makes the two auth vars the first step and states
  that basic auth over plain HTTP beyond loopback needs a TLS reverse proxy
  or Tailscale.
- `ALLOWED_HOSTS` (default derived from `PORT`: `localhost:<port>,127.0.0.1:<port>`,
  plus the Vite dev origin `localhost:5173` under `NODE_ENV=development`);
  rejection names the header value and the variable; setup docs give
  Tailscale and reverse-proxy examples. Mutating routes require
  `Content-Type: application/json` and `X-Requested-With: get-me-there`;
  `Origin` when present must match the allowlist.
- Security headers: CSP `default-src 'self'`, `frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. Tested.

---

## 5. Provider interface

### 5.1 Contract (`core/provider.ts`, WP0)

```ts
export type ProviderId = 'travelpayouts' | 'searchapi' | 'camoufox' | 'fixture';
export type SourceKind = 'authorised-cached' | 'scraped-aggregate' | 'scraped-search' | 'scraped-self' | 'synthetic';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';

export interface CapabilityInfo { sourceKind: SourceKind; provenanceNote: string; maxAgeHours: number | 'unknown' }
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }

export interface DiscoveryQuery {
  origin: Iata; destination: Iata;
  departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number;
  cabin: Cabin; currency: 'GBP';
  cells?: CellKey[];     // when set, discovery.plan RE-PLANS over this subset (fewer calls); tiles still partition it
  airportNames?: { origin: string[]; destination: string[] };   // names from the airports dataset, set by the engine for a provider that matches airports by name (camoufox)
}
export interface TilePlan { index: number; coveredCells: CellKey[]; request: TileRequest }   // vendor-neutral, typed
export type TileRequest =
  | { kind: 'month'; month: IsoMonth }                                   // Travelpayouts month tiles
  | { kind: 'length-month'; length: number; month: IsoMonth }
  | { kind: 'month-pair'; departMonth: IsoMonth; returnMonth: IsoMonth }
  | { kind: 'rectangle'; departFrom: IsoDate; departTo: IsoDate; returnFrom: IsoDate; returnTo: IsoDate };

export interface CellIssue { cell: CellKey; reason: ErrorReason; offersDropped: number; detail: string }   // a covered cell the adapter could not price honestly
export interface RawCalendarPrice extends CellKey {
  amountMinor: number; currency: string; providerObservedAt?: IsoDateTime; vendorLink?: string;
}
export type DiscoveryTileResult =
  | { kind: 'tile'; index: number; coveredCells: CellKey[]; fetchedAt: IsoDateTime; pointOfSale: PointOfSale; prices: RawCalendarPrice[]; noFares: CellKey[]; notes: string[];
      cellIssues?: CellIssue[];   // per covered cell: rows dropped at normalisation or cells left unread, each with a closed-list reason; the engine writes `error` with that reason, never `no_data`
      truncated?: boolean }       // the pagination cap stopped the tile early; its prices are labelled "cheapest of the rows read"
  | { kind: 'tile-error'; index: number; coveredCells: CellKey[]; error: ProviderError };

export interface ItineraryQuery extends CellKey { cabin: Cabin; adults: 1; currency: 'GBP'; maxStops?: number; expandTop: number; bookingLinks: boolean }
export interface RawSegment { marketingCarrier: string; operatingCarrier?: string; flightNumber: string; from: Iata; to: Iata; depart: string; arrive: string; timeKind: 'local' | 'utc' | 'offset'; cabin?: Cabin; durationMinutes?: number; aircraft?: string }
export interface RawOffer {
  outbound: RawSegment[]; inbound: RawSegment[]; seller: string; requestedCabin: Cabin;
  amountMinor: number; currency: string; taxesIncluded?: boolean;
  baggage?: BaggageSnapshot; fareConditions?: FareConditions; selfTransfer?: boolean;
  booking: { kind: 'get'; url: string } | { kind: 'post'; url: string; postData: string } | { kind: 'none' };
  bookingExpiresAt?: IsoDateTime;
  verified: boolean;   // true only when the final chain step confirmed this price; every earlier-step offer is written as unverified
}
export interface ItinerarySearchResult {
  offers: RawOffer[]; coverage: 'priced' | 'empty'; fetchedAt: IsoDateTime; pointOfSale: PointOfSale; partial: boolean; failedExpansions: number; notes: string[];
  routeHistory?: Array<{ date: IsoDate; lowestPriceMinor: number; currency: string }>;   // SearchApi price_insights.price_history; the engine upserts route_price_history
}
// offers: every return option of every expanded outbound, one RawOffer each; the cheapest per outbound is the step-3 candidate.

export interface ProviderContext { executionId: string | null; signal: AbortSignal; recordFixtures: boolean }
// Adapters are constructed once with { http: HttpKit, log: Logger, clock: Clock }; the context carries only per-call state.

export interface DiscoveryCapability { info: CapabilityInfo; plan(q: DiscoveryQuery): TilePlan[]; fetchTile(plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult>;
  preflight?(ctx: ProviderContext): Promise<{ ok: true } | { ok: false; skip: 'provider_disabled' | 'provider_unavailable'; detail: string; until?: IsoDateTime }> }   // unledgered; camoufox reads the worker's /v1/status
export interface VerificationCapability { info: CapabilityInfo; estimate(q: ItineraryQuery): CostEstimate; search(q: ItineraryQuery, ctx: ProviderContext): Promise<ItinerarySearchResult> }
export interface FlightProvider {
  readonly id: ProviderId; readonly displayName: string;
  readonly suppliedFields: readonly SuppliedField[]; readonly cabins: readonly Cabin[];
  readonly discovery?: DiscoveryCapability; readonly verification?: VerificationCapability;
  healthcheck(ctx: ProviderContext): Promise<{ ok: boolean; detail: string }>;
}
export interface CostEstimate { calls: number; costMicroGbp: number; seconds: number; notes: string[] }

export interface Reservation { id: string; finalise(r: { outcome: 'ok' | 'error' | 'unknown'; httpStatus?: number; durationMs: number }): void }
export interface BudgetGuard {
  reserve(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; costMicroGbp: number; httpAttempt: number; endpointPath: string }): Reservation;
  recordCacheHit(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; endpointPath: string }): void;
  usage(scope: BudgetScope): Usage;
}
export interface ResponseCache { get(key: string): { body: unknown; storedAt: IsoDateTime } | undefined; set(key: string, body: unknown, ttlSeconds: number, storedAt: IsoDateTime): void }
export interface Notifier { id: string; send(msg: AlertDigest | OperatorMessage): Promise<{ ok: boolean; detail?: string }> }

export class ProviderError extends Error { kind: 'auth' | 'rate-limit' | 'quota' | 'upstream' | 'parse' | 'network' | 'limiter-timeout' | 'blocked' | 'provider-unavailable'; reason?: string; retryable: boolean; httpStatus?: number; retryAfterSeconds?: number }   // 'blocked', 'provider-unavailable': camoufox only, never retryable
export class BudgetExceeded extends Error { scope: 'execution-calls' | 'execution-free-calls' | 'execution-cost' | 'provider-execution' | 'provider-month' | 'provider-lifetime' | 'global-month' }   // 'provider-execution': a provider's own per-execution cap (camoufox pages)
export class AbortedError extends Error {}
```

### 5.2 Adapter responsibilities

- **Tiling.** `plan` is pure and deterministic and tiles **partition** the
  query's cells (asserted). With `cells` set it re-plans over that subset. A
  tile is one logical request; a paginated endpoint fetches all its pages
  inside one `fetchTile`, each page ledgered with the tile's `tile_index`,
  and parity counts tiles. **Travelpayouts** (measured): `month` tiles on
  `/aviasales/v3/prices_for_dates` with `departure_at=YYYY-MM`,
  `one_way=false`, `currency=gbp`, `limit=1000`, no `return_at`; the query
  stays per (origin, destination) pair and `origin` is always the airport
  code (never a metro code, §2); rows are attributed by `origin_airport`
  and filtered to the pair and the nights band. Logical tiles per scan:
  `O × D × M`, each an upstream call (the worked example: 2 origins × 2
  destinations × 7 months = 28 tiles, 28 free calls). **SearchApi** (measured):
  `rectangle` tiles of the largest outbound block b with
  b × (b + maxNights − minNights) ≤ 200 (9 days × a 20-day return span for
  the 10–21-night band: 180 combinations), asserted ≤200 before reserve;
  ~21 tiles per pair for a 182-day window (the worked example: 4 pairs ≈ 84).
  **Camoufox** (§2): `list` mode, the only one built, plans one tile per
  cell (a 1 × 1 `rectangle`); the designed `grid` mode plans one tile per
  page, a `grid-path` (its first block's query and its moves) whose covered
  cells are its blocks' cells inside the window and nights, from a path over
  `⌈D / 7⌉ × ⌈(7 + maxNights − minNights) / 7⌉` blocks a pair (§2); a
  re-plan visits only the blocks holding a resumable cell.
- **Cell keys from the response**; entries outside `coveredCells` or with
  nights ≠ the requested length are dropped and counted in `notes`. A
  Travelpayouts row whose link token names a round trip other than the
  cell's (an open jaw) is dropped and reported per cell; a row whose link
  token cannot be read is priced on the row's own airports and counted
  `itinerary-unreadable:n`, so the gap in that check is visible.
- **Stops.** SearchApi `google_flights` sends the documented `stops` value
  when the query has `maxStops` (0 `nonstop`, 1 `one_stop_or_fewer`, 2
  `two_stops_or_fewer`; nothing above 2), so billed calls go to itineraries
  the rule allows; verdicts still check stops from the segments.
- **Cheapest set.** SearchApi `google_flights` sends
  `show_cheapest_flights=true` on every step beside `sort_by=price`, since
  Google's default is its "best" set, which may leave a cheaper option out;
  each step is still one billed search. `google_flights_calendar` has no
  such parameter and sends none.
- **Empty is per capability.** `authorised-cached`: a schema-valid success
  envelope with zero entries → every covered cell `no_data`; a malformed
  envelope or `success:false` → `parse`. `scraped-aggregate`: an empty grid
  under a passing ≤200 assertion → `parse`; `has_no_flights: true` →
  `noFares`. Tested with recorded fixtures for both.
- **Estimate parity.** `plan(q).length` is the estimate; parity (§8.1) is
  measured as distinct tile requests.
- **Raw only.** Currency from the response. Per-segment `cabin` when the
  vendor states it; `requestedCabin` is what was asked. Nothing defaulted.
  `suppliedFields` checked against **recorded** fixtures.
- **Point of sale.** SearchApi `gl` is `POINT_OF_SALE` lower-cased
  (default `GB`), `hl=en`, `currency=GBP`, stored as `pointOfSale` from the
  echo in `search_parameters`. Travelpayouts
  `currency=gbp` only: its `market` parameter is ignored by the vendor, so
  it stores `pointOfSale: 'unknown'`, and `trip_class` is ignored too, so
  it declares `cabins: ['economy']` and the engine marks every cell
  `no_data` with reason `cabin-not-offered` for a non-economy definition
  without calling it. All hard-coded. The dated allowlist
  (`fixtures/recorded/<provider>/params-<date>.json`) enumerates parameter
  names **and values**; tests assert both, and the code's allowlist equals
  the newest file. A parameter added later from the vendor docs is a later
  dated file; each recording keeps the allowlist of its date, and replay
  matches a request against a recording made before a parameter existed
  without that parameter only, every other name and value still matching.
- **Errors.** 401/403 → `auth`; 402 → `quota`; 400 → `parse`
  (non-retryable) with the vendor's message in `last_error`; 404 → `upstream`
  non-retryable; 429 → `rate-limit`, or `quota` when the adapter's
  classifier recognises a quota body (the ledger cannot tell the two apart
  for a billed vendor: a refused reservation never reaches the vendor);
  SearchApi's classifier treats any 402, and a 403 or 429 whose body names
  credits or quota, as `quota`, never retried, the HTTP code in the message;
  a 429 without `Retry-After` waits the provider's configured
  fallback (Travelpayouts 60 s) or, with none, is non-retryable with a
  retry time at the hourly window;
  other 5xx → `upstream`; malformed → `parse`; socket → `network`; per-request timeout (`REQUEST_TIMEOUT_SECONDS`, separate from
  `ctx.signal`) → `network` finalised `unknown` and **not retried for billed
  vendors**; limiter deadline → `limiter-timeout`. The `camoufox` worker's answers map
  as follows: 423 `blocked` and `cooling-down` → `blocked`, non-retryable;
  409 `mode-unavailable` → `parse`, non-retryable; 401 → `auth`; 429
  `spacing` → `rate-limit` with its `Retry-After`; 5xx, a timeout or a dropped
  socket → `upstream` or `network`, **never retried for camoufox** (a retry
  could load Google twice for one tile); a refused connection →
  `provider-unavailable`, non-retryable. `signal.aborted` →
  `AbortedError`. No adapter-level retries anywhere; http-kit retries.
- **Vendor links.** `vendorLink` and `booking.url` are validated in `core`
  at normalisation and again in `api-contract`: `https:`, no userinfo, host
  equal to or a subdomain of an entry in the provider's link allowlist
  (`aviasales.com` for Travelpayouts; `google.com` for SearchApi, whose
  step-3 `booking_request` always targets Google, and for `camoufox`), else
  `{ kind: 'none' }`.
  Seller or airline hosts are never linked directly.

### 5.3 http-kit (`packages/providers/src/http/`)

`createHttpKit({ budget, cache, limits, clock, log, secrets, syntheticAllowed, recorder?, inProcessHosts? })`
over `globalThis.fetch`. The one transport seam is `inProcessHosts`: a
hostname-keyed in-process handler that only wiring under `syntheticAllowed`
may supply (http-kit refuses it otherwise), used for `http://fixture.local`;
tests intercept with `msw` on global fetch. A request that joins an identical
in-flight request records its own cache-hit ledger row and is raced against
its own signal; an adapter may veto caching a body it cannot parse. FX refresh goes through http-kit under
the id `fx` (never ledgered, no caps, host allowlist `api.frankfurter.dev`).
Pipeline, fixed:

```
cache lookup ─hit─▶ budget.recordCacheHit ─▶ return { body, fetchedAt: storedAt }
   │miss
in-flight dedup
p-retry (max 3 attempts; Retry-After honoured up to MAX_WAIT_SECONDS, beyond → limiter-timeout) {
   limiter (chained per-minute + per-hour reservoirs, maxConcurrent; queue age ≤ MAX_WAIT_SECONDS and !signal.aborted checked before reserve)
   budget.reserve  (one BEGIN IMMEDIATE transaction: cap predicates, insert provider_requests outcome='pending')
   fetch (per-provider hostname allowlist; redirect: 'error'; REQUEST_TIMEOUT_SECONDS; credentials in header when supported)
   reservation.finalise
}
cache.set when cacheable  →  return { body, fetchedAt: now }
```

- **Billable rule**: `searchapi` iff upstream HTTP 200 **and** the plan is
  a per-call plan (on subscription plans every call is billable for the
  call cap but costs 0 micro-GBP); `travelpayouts`, `camoufox` and `fx` never (a `camoufox` row
  whose answer says Google was not contacted is finalised with the outcome
  class `no-page`, which the page caps do not count, §2); cache
  hits never; `fixture` iff HTTP 200 at the configured test cost (only
  under `syntheticAllowed`).
- **Cap predicates** (SQL in `reserve`):
  - `provider-month`/`provider-lifetime`: billed vendors count rows
    `outcome IN ('pending','unknown') OR billable = 1`; free vendors count all
    non-cache rows; cost sums `cost_micro_gbp` over the same rows.
  - `execution-calls`: billed-vendor rows of this execution by the same
    rule; `execution-free-calls`: free-vendor rows of this execution.
  - `global-month`: `Σ cost_micro_gbp` (billed rows) **plus
    `PLAN_FIXED_PENCE × 10 000` for each enabled subscription provider**, so
    `MONTHLY_SPEND_CAP_PENCE` means total monthly spend. On a subscription
    plan the per-call cost is 0, so the fee is counted once and the plan's
    call cap is the hard stop; per-call cost applies only on per-call plans.
  - A cap of 0 refuses when `current + this > 0`; zero-cost calls pass.
  - Pre-start checks use `usage(scope) + estimate ≤ cap` per scope.
- **Crash between reserve and finalise**: boot sweep marks `pending` older
  than 10 minutes `unknown` (still counted). Aborted attempts finalise
  `unknown` before `AbortedError` propagates (tested). Every ledger row
  carries `tile_index` (NULL for verification) so parity can count tiles.
- **Cache**: key = sha256 over the credential-free canonical request; bodies
  scrubbed of credentials; token-bearing SearchApi step responses never
  cached; TTLs from config.
- **Egress**: hostname allowlist per provider; `redirect: 'error'`; a test
  proves a 302 elsewhere sends no credentials. One exception to `https:` and
  no explicit port: `camoufox` requests go to `CAMOUFOX_WORKER_URL` exactly
  (scheme, host and port), which must name a loopback host or
  `host.docker.internal` with an explicit port, with `CAMOUFOX_WORKER_KEY` in
  the `x-gmt-worker-key` header (a credential header by name); the never-
  ledgered id `camoufox-status` (like `fx`) reaches only that origin's
  `/v1/status`; the worker, not http-kit, holds the Google allowlist (§2). Every credential travels in a
  header, so http-kit refuses a query parameter named like one (`api_key`,
  `key`, `token`, `access_token`, `password`, `secret` and the like) whatever
  its value, before the ledger or the network; SearchApi's `departure_token`
  and `booking_token` are itinerary tokens, not credentials.
- **Secret scrubbing**, one rule for every sink: `provider_requests.endpoint_path`
  is the path only (no query); cache keys exclude credentials and cache
  bodies are scrubbed of credentials before storage; `ProviderError.message`
  never contains a URL; every URL written to `cell_outcomes.last_error`,
  `search_executions.error_text`, `alert_events.payload_json`, API
  `error.details`, email bodies or pino output has its query string and
  userinfo stripped, with one exception: a validated booking or search link
  (`https:`, allowlisted host, §5.2) is written whole to API bodies and
  emails, since the query is the link; pino `redact` covers `apiKey`, `token`, `authorization`,
  `url.query`, `req.headers.authorization`; the recorder fails closed. The
  sentinel-key test configures fake values for every secret (both provider
  keys, the SMTP password, the basic-auth password), exercises every path
  including error paths, and asserts none appears in any log line, DB
  column, error message, API body, email or fixture file. CI runs the same
  secret scan over `fixtures/` and the repo's `.gitignore` covers `.env*`,
  `data/`, `*.db*` and `backups/`.
- **Recorder**: `fixtures/recorded/<provider>/<endpoint>/<yyyy-mm-dd>-<sha>.json`;
  credentials fail closed; `search_metadata` URLs stripped; **opaque vendor
  tokens are replaced by deterministic placeholders** of the form
  `<key:n@session>` (key = the token's field name, n = its ordinal within the
  recording session) consistent between a response and the next request so
  chains replay.

### 5.4 SearchApi itinerary flow

Vendor parameter names from the allowlist (`travel_class` values `economy |
premium_economy | business | first_class`). Step 1 (outbound options,
cheapest-first among the options the vendor returns; every step sends
`show_cheapest_flights=true` and `sort_by=price`) → step 2 per `expandTop` outbound (round-trip price for that
pairing) → optional step 3 (`booking_token` → options; `booking_request` is a
POST, stored as `{ kind: 'post', url, postData }`, rendered as a browser form,
never fetched server-side; phone-only → `none`).

Options at any step may carry **no `price`** (the spike saw two of nine at
step 1 and one of three at step 2); they are skipped and counted in
`notes`, never persisted. Each step-2 response lists several return
options for the expanded outbound; **every priced option is persisted as
its own offer** (same call, no extra cost), and step 3 runs for the
cheapest priced option per outbound. Outcome rules (all tested): step 1 zero options → `empty`; step 1
options but every step 2 fails or returns no legs → throw `upstream` with
`reason = 'no-return-legs'` (non-retryable on resume; "fails" means an
`upstream`, `network` or `parse` error, while `auth`, `quota`, `rate-limit`
and `limiter-timeout` from any step propagate unchanged and are never counted
as a failed expansion); some step 2 succeed →
`priced` with `partial: true` and `failedExpansions`; a step 2 that succeeds
with zero legs contributes nothing; a cell is `priced` only if ≥1 offer is
written. **Price source rule (settled by the spike):** the step-2 price is
the airline's own fare and step 3 can show an OTA below it (£603 vs £573
on the probe), so `bookingLinks` is **forced `true` for SearchApi**
(enforced in zod), every step-3 option is persisted as an offer with its
`book_with` seller, `baggage_prices` and booking POST, and the step-2
price is kept only as the airline-direct offer when no step-3 option names
the airline. Three cases the vendor can produce: every step-1 option
unpriced → throw `upstream` with `reason = 'no-priced-options'`
(non-retryable on resume); a failed step 3 keeps the step-2 airline offer
and the cell is `priced` with `partial: true`; split bookings
(`is_split_booking`) are skipped and counted in `notes`. A malformed
option at step 1 or step 2 is dropped and counted in `notes`, and the result
is `partial: true` (written `partial-expansion`), since its fare may be the
cheapest; a step whose every option is malformed is a `parse` error, never
"no options". Calls per cell:
`1 + expandTop × 2`; the default `expandTop 2` costs 5.

### 5.5 Fixture provider and the synthetic gates

```ts
syntheticAllowed(c: Config): boolean =
  (c.nodeEnv === 'test' && (c.databasePath === ':memory:' || c.databasePath.endsWith('.test.db')))
  || (c.allowFixtureProvider === 'i-understand-this-is-fake' && c.nodeEnv === 'development' && !c.inContainer && c.databasePath.endsWith('.fixture.db'))
```

`databasePath` is realpath-resolved in bootstrap before the config is built.
The Dockerfile sets `NODE_ENV=production` and `IN_CONTAINER=1`; compose
passes an explicit `environment` allowlist (never `ALLOW_FIXTURE_PROVIDER`).
Both the app bootstrap and the tool bootstrap refuse `NODE_ENV=test`, and
the recorder only writes under `fixtures/recorded/` with a content hash and
`recordedBy` signature that the fixture-tree test verifies. The fixture provider's constructor
takes the config slice and throws when the predicate is false; repositories
reject `source_kind = 'synthetic'` when it is false, and reject any row where
`provider_id = 'fixture'` ⇔ `source_kind = 'synthetic'` does not hold. Every
fixture price is `synthetic` unconditionally. Alerts and notifiers refuse
synthetic rows. The UI banner is data-driven; a negative test asserts its
absence for real data. Tests: the truth table incl. traversal and symlink
cases; injected-config boot matrix; **one test spawning the real bootstrap
with a real production environment**; a Dockerfile assertion.

### 5.6 Normalisation step (engine)

For every raw price or offer: airport tz from the airports repository
(unknown → `error: unknown-airport-tz`, never hash UTC); `departLocal` per
segment via `@date-fns/tz` (nonexistent wall times shift forward, ambiguous
take the first occurrence; tested on a UK/EU DST change); canonicalise and
hash (§6.4); evidenced cabin only when every segment states one, else the
cabin verdict is `unverified`; money via `toGbp` with the FX repository
(`FX_MAX_RATE_AGE_DAYS` 3; ECB-covered currencies only; missing →
`error: fx-unavailable`); `fx_rate_nano` = GBP per native unit × 1e9,
`fx_rate_date`, `fx_source` stored together under a CHECK constraint.
Offers that fail normalisation are dropped and counted as
`offers-dropped:n` on a `priced` outcome; the cell is `error` only when no
offer survives. Per `(provider, cell)` the engine keeps **one** calendar
price per tile (the minimum `amountMinor`, tie-break on vendor order) and
counts discards; the roll-up `min_pence` is the minimum over rows actually
written. Evidenced per-segment cabins are stored on the observation
(`segment_cabins_json`), never on the shared `segments` rows. FX rates come
from frankfurter (`https://api.frankfurter.dev/v1/latest?from=GBP`; the
older `.app` host redirects and http-kit refuses redirects) through http-kit
under the id `fx` (host-allowlisted, never ledgered), refreshed daily by a
scheduled job that runs after boot.

---

## 6. Core domain (pure functions, `packages/core`)

### 6.1 Search-space generation
```ts
resolveWindow(def: WindowSpec, todayLondon: IsoDate): { departureFrom: IsoDate; departureTo: IsoDate; clamped: boolean }
generateCells(space: ResolvedSpace): Cell[]      // deterministic order: origin, destination, departureDate, nights
countCells(space): number                         // closed form, no allocation; the estimate and caps use it
validateSearchSpace(def, todayLondon: IsoDate, lookup: { exists(iata): boolean; metroOf(iata): string | null; airportsOfMetro(code): Iata[] }, maxCells: number): ValidationResult   // a metropolitan code is rejected naming its airports
```

Windows are **absolute** `{ from, to }` or **relative** `{ startOffsetDays ≥ 1,
lengthDays }`. Relative windows resolve at execution start in
`Europe/London` and are frozen into the execution snapshot. Absolute
windows are clamped to start no earlier than tomorrow (noted in the
estimate). A window that resolves to zero cells makes a scheduled tick
record status `skipped_window` with an operator notification and disable
the schedule, and makes `POST` return 422.

Dates are **calendar dates** independent of process timezone: epoch-day
integers and `Intl` only, never `Date`-local arithmetic.
`returnDate = departureDate + nights` for `nights ∈ [minNights, maxNights]`;
window ends are inclusive. Validation: IATA format `^[A-Z]{3}$` and
existence via the supplied lookup; `to ≥ from`; window ≤ 400 days;
`0 ≤ minNights ≤ maxNights ≤ 90`; ≥1 origin and destination, disjoint;
`countCells ≤ MAX_CELLS_PER_DEFINITION`; `alwaysInclude` members of the
space resolved **at save time**. At execution start, `alwaysInclude` cells
that have slid out of a relative window are dropped with a note, not an
error.

Tests: hand-computed counts for the default space (2 × 3 × 182 × 12 =
13,104) and a literally enumerated tiny space (1 × 1 × 3 days × 2 nights =
6 cells, listed), with `countCells === generateCells().length` only as a
secondary property; leap day 2028-02-29; the 2027→2028 boundary; windows
spanning the March and October DST changes with the suite run under
`TZ=Europe/London` and `TZ=UTC`; min = max nights; single-day window;
multi-origin × multi-destination ordering; relative resolution across a
month end; clamping; zero-cell windows; `startOffsetDays = 0` rejected;
unknown IATA rejected.

### 6.2 Constraints and verdicts
```ts
evaluateConstraints(it, offer, c: Constraints, supplied: readonly SuppliedField[]): Verdicts
verdictClass(v): 'verified' | 'partially-verified' | 'failed'
// An offer whose `price` is not a supplied field (a chain step the final step did not confirm) is classed
// `unverified` with the label "price not confirmed by the final step", whatever the constraints say (plan decision 37).
// Calendar prices reach GBP through core's exported `priceInGbp` (the same rules as normaliseOffer's money step).
```

Evaluated **at read time** against the current definition, using the
observation's stored `supplied_fields_json`, so edited constraints apply to
old observations correctly. Rows whose cell is outside the current resolved
window or nights range are excluded from results and labelled in history.

| Constraint | Field needed | Rule |
|---|---|---|
| cabin | evidenced per-segment cabins (never `requestedCabin`) | fail if any segment below requested; `unverified` unless every segment states its cabin (mixed-cabin itineraries such as premium long-haul plus an economy domestic leg are common on these routes) |
| maxStops | segments | per direction |
| maxJourneyMinutes (default 1500 per direction in the default definition) | segment times | per direction |
| minLayoverMinutes / maxLayoverMinutes | segment times | every layover |
| noOvernightLayover | segment times + tz | layover spanning 00:00–05:00 local |
| departureWindowLocal / arrivalWindowLocal | first/last segment local times | outbound and inbound |
| noSelfTransfer | observation `selfTransfer` | unverified if absent |
| noAirportChange | segment airports | |
| includeAirlines / excludeAirlines | marketing carrier | any segment |
| cabinBagRequired / checkedBagRequired / minCheckedBags | baggage | unverified when absent |
| maxPricePence | price | |

Absent input → `unverified`, tested per row of this table. `failed` iff any
`fail`.

### 6.3 Normalisation and money
`NormalisedItinerary` = `{ hash, origin, destination, departureDate, returnDate, nights, outbound: Segment[], inbound: Segment[], outboundMinutes?, inboundMinutes?, stopsOut, stopsIn, layovers: Layover[], airportChange?, marketingCarriers: string[] }`.
`Segment` = `{ marketingCarrier, operatingCarrier?, flightNumber: number, from, to, departLocal, arriveLocal, departUtc?, arriveUtc?, durationMinutes?, aircraft? }`.
Cabin is on the offer; evidenced per-segment cabins and `selfTransfer` are
on the observation (they are fare attributes, not itinerary attributes).

**Money.** Prices: integer pence, `*Pence`/`*_pence`. Provider costs:
integer micro-GBP, `*MicroGbp`/`*_micro_gbp` (SearchApi costs 0.32p a
call). Operator-facing config is in pence (`*_PENCE`) converted once at the
config boundary; comparisons are `pence × 10 000 ≥ microGbp`. FX rates are
integer **nano**: `fx_rate_nano` = GBP per 1 unit of native currency × 1e9
(micro would keep only ~4 significant figures for JPY). Native amounts are
integer minor units with the ISO 4217 exponent. `toGbp` rounds half-up to
the penny and is tested against CNY and JPY reference values in that
direction. No float ever holds money; zod and repositories reject
non-integers.

**Timestamps**: `Date.prototype.toISOString()` form only
(`2026-10-14T15:00:00.000Z`); vendor times normalised to it in `core`;
repositories reject other forms.

### 6.4 Itinerary identity
`itineraryHash` = sha256 over `'OUT|' + segs(outbound) + '|IN|' + segs(inbound)`,
each segment `${carrier}:${flightNumber}:${from}:${to}:${departLocal}`
after canonicalisation: carrier matches `^[A-Z0-9]{2}$` (IATA designators
are alphanumeric, e.g. `4U`); an unmappable carrier is a normalisation error
for that offer, never a guess; `flightNumber` integer without leading
zeros; airports upper-case IATA; `departLocal` exactly `YYYY-MM-DDTHH:mm`
local to the departure airport. An offer whose local departure cannot be
derived (UTC input with an unknown airport tz) is a normalisation error
`unknown-airport-tz`; UTC is never hashed. Codeshares hash on the
**marketing** carrier. Excludes price, cabin, provider, seller, tokens.
Matrix tests: `VS 938`/`VS938`/`0938`, `4U 8888`, `T` vs space, UTC vs
local vs offset inputs, unknown tz.

### 6.5 Dedup, ranking and filters

Pure functions shared by `api` and `web`. **Dedup**: one results row per
itinerary hash, showing that itinerary's best offer in the definition's
cabin, chosen by verdict class, then seen-in-latest-search, then price, then
freshness; the other offers for that itinerary appear in the expanded row
with their own class and unverified constraints. Stale rows are labelled,
never demoted (hiding them is the opt-in filter). `/results` returns up to 1000 such rows ranked by verdict
class (verified, partially-verified, failed) then price, for the chosen
basis and execution set; **all sorting and filtering happen client-side**
on that set with these functions, composing without refetch; when
`truncated`, the header says "within the cheapest 1000 of N". Sort keys:
price, total travel time, departure, return, nights, stops, adjusted.
Filters: verdict class, unverified-constraint name, provider, stops,
carriers, destination, max price, nights range, stale. `bandCheapest(rows,
6h)` marks the cheapest per travel-time band.

### 6.6 Coverage math and roll-up precedence

| # | Condition | Roll-up |
|---|---|---|
| 0 | no outcome rows (stage has no provider, or selection not yet persisted) | `NULL` / `not_applicable` |
| 1 | any `priced` | `priced` |
| 2 | any `not_run` | `not_run` |
| 3 | any `error` | `error` |
| 4 | any `empty` and every other ∈ {empty, no_data, skipped} | `empty` |
| 5 | any `no_data` | `no_data` |
| 6 | all `skipped` | `skipped`, reason by priority budget > provider_disabled > provider_unavailable > scheduled_only > departed > not_selected |

`no_data` outcomes whose reason is `cabin-not-offered` are ignored whenever
any other outcome exists for the cell; a cell whose only outcomes are
cabin-not-offered rolls up to `no_data` with that reason. Roll-up reasons: a
`priced` roll-up carries `partial-expansion` when any priced input has it;
`error` carries the reason when every error input agrees, else `mixed`;
`skipped` keeps the priority above. Within one provider, monotone merge
`priced > empty > no_data > error`, `min_pence = min`, every other field
travelling with the input that supplies the minimum (tiles partition cells,
so this is a safety net, tested); a fresh write replaces a reused copy
outright.
Discovery re-plans only over `not_run` cells, so a reused cell is never
fetched again in the same execution; the §7 supersede rule is a safety net
in the tile write, not a path the planner takes. Coverage
fractions in the UI always show the **six buckets** of §3 (priced, no
fares, no cached data, error, skipped, not searched), which sum to the cell
count; "searched" as an umbrella appears only in View D beside the
breakdown. "Selected but not reached" = `selected ∧ (not_run ∨
skipped:budget)`. Property test from an independent enumeration of the
table.

### 6.7 Candidate selection
`policy = { maxCells; topN ≤ maxCells; priceCeilingPence?; perDepartureDateBest?; alwaysInclude: CellKey[] (|·| ≤ maxCells, members of the resolved space) }`.

Selection runs **once per execution**, guarded by `stage`, and is never
recomputed on resume. It refuses a policy whose deduplicated in-space
`alwaysInclude` exceeds `maxCells` or whose counts are not non-negative
integers (validated at save time too), so `maxCells` is a hard bound on
verification spend; the stride walks only cells not already chosen. Child executions bypass it entirely (`alwaysInclude =
[cell]`, `maxCells = 1`, no discovery).

1. Start with `alwaysInclude` (deduplicated, counted toward `maxCells` and
   toward `perDepartureDateBest`).
2. Rank cells with a `priced` discovery roll-up by `discovery_min_pence`,
   tie-break generation order.
3. Walk, skipping `alwaysInclude` members: add if under `maxCells` and, when
   `perDepartureDateBest` is set, that date has fewer than that many
   selected; stop after `topN` additions.
4. If `priceCeilingPence` is set, continue walking, adding only cells ≤
   that ceiling, still honouring `perDepartureDateBest`, until `maxCells`;
   if unset, stop after step 3.
5. Fallback when the execution has **no** discovery provider: replace 2–4
   with an even stride over generation order. `m = maxCells −
   |alwaysInclude|`; if `m ≤ 0` the stride adds nothing; otherwise `k =
   max(1, floor(total / m))`, start at index 0, take at most `m` cells,
   advancing past `alwaysInclude` members rather than losing a slot.
6. Record `selection_reason ∈ always_include | top_n | ceiling | stride`.

The estimate uses `maxCells` as the upper bound. Sparse discovery is
remedied by `alwaysInclude` and single-cell verify, not by stride.

### 6.8 Alert evaluation
Rule: `{ type: 'absolute' | 'dropPct' | 'dropAbs', thresholdPence | pct, basis: 'verified' | 'calendar', requireAllVerified (verified basis only; zod rejects it on calendar basis), cooldownHours (default 336, deliberately not equal to the weekly cadence) }`.

- **Verified basis** identity = `(ruleId, itineraryHash)`; candidates are
  price observations **written by the current execution** with class
  `verified`, or `partially-verified` when `requireAllVerified` is false
  (the firing lists the unverified constraints); drops compare the latest
  observation of an offer with its previous one.
- **Calendar basis** identity = `(ruleId, providerId, cabin, cellKey)`;
  candidates are calendar prices fetched by the current execution (reused
  rows are excluded) in the definition's cabin; drops compare only with a
  previous price for the same `(providerId, cabin, cellKey)` whose
  **`fetchedAt`** is within 2 × `discoveryRefreshHours` (tested at 167 h,
  168 h and 169 h with `maxAgeHours` 168); absent-then-present is listed in
  the digest's "new" section and is never a drop firing (absolute rules
  still apply to it); the body shows the previous price and its age. Allowed
  whenever the operator opts in; the subject carries "constraints not
  checked". When verification is budget-skipped the operator is told
  "alerts running on calendar basis only".
- `dedupKey = identity + floor(pricePence / 100)`. Suppressed if the same key
  fired within `cooldownHours`, or the same identity fired within it at a
  price that is not at least max(£10, 5%) above the new one (a fare
  drifting down £1 a day sends one email, not seven). Each identity is
  judged on its cheapest eligible candidate. Suppressed firings are
  recorded with status `suppressed`. Synthetic rows are refused.
- Firings are delivered as **one digest per rule per execution** listing
  the top 10 and a count of the rest (tested: 50 qualifying cells → one
  email). Returns the digest with reason text.

### 6.9 Results basis
`basis: 'verified' | 'calendar'`. Verified basis ranks observations (class
`verified` and `partially-verified`; `failed` excluded by default, included
by filter). Calendar basis ranks calendar prices as rows with class
`unchecked`, no segments, an explicit "not checked" marker in every
segment-derived column, stops/carrier filters disabled, and an inline note
naming the configured constraints that are not applied ("not applied:
arrival window, max journey, stops").

Calendar basis rows are the latest fetched price per `(providerId, cellKey)`
in the definition's cabin from executions of this definition, ignoring
reused copies (same `fetchedAt` as their origin). The **default basis is
calendar when the snapshot has no verification provider or no observations
exist**; the header says why and offers a one-click switch. Per-cell
verify actions and the calendar-gap banner are hidden when the definition
has no verification provider.

Every row on either basis carries a labelled **search link** whenever
`booking` is `none`: a calendar row's own stored vendor link, re-validated
against the provider's allowlist, comes first, labelled "the vendor's link
for this cached row, not a fare link"; otherwise a generic search (an
Aviasales search for Travelpayouts, a Google Flights search URL for
SearchApi cells, which may not prefill every field), labelled "search link,
not a fare link". Synthetic rows carry none.

---

## 7. Data model (`packages/db`)
Conventions: `*_pence`, `*_micro_gbp`, `*_nano` are `integer`; timestamps
are `toISOString()` text; booleans are integers 0/1.

- `airports` (iata PK, icao, name, city, country, tz NOT NULL, lat, lon,
  metro NULL, source, dataset_version). Seeded from a vendored, versioned
  `mwgg/Airports` dataset (MIT, has IANA `tz`; it carries no metropolitan
  codes, so `metro` comes from a separately vendored, attributed list of
  IATA metropolitan area codes beside it); re-seeded by upsert when the
  dataset version changes; the sanity check that the table holds at least
  5,000 rows with IATA code and tz, and that every airport referenced by an
  enabled definition exists, **fails boot** if it fails; no network at
  seed. No specific airport is named in code.
- `search_definitions` (id, name, origins_json, destinations_json,
  window_json {kind: absolute|relative, …}, min_nights, max_nights, cabin,
  constraints_json, verification_policy_json NOT NULL, budget_json NOT NULL
  {maxCalls, maxFreeCalls, maxCostMicroGbp}, providers_json {discovery[],
  verification[], discoveryRefreshHours{} (default 168 per provider)},
  destination_notes_json {dest: text} NULL, onward_cost_json {dest: pence} NULL, schedule_cron NULL, schedule_tz NOT
  NULL, confirmed_cost_pence NULL (set **only** from an explicit
  confirmation the operator submits after seeing the estimate; never
  recomputed automatically), confirmed_calls NULL (set together with
  confirmed_cost_pence from the same explicit confirmation; the pre-start
  comparison covers both), enabled, deleted_at NULL, created_at,
  updated_at). Soft-deleted.
- `search_executions` (id, definition_id, is_child NOT NULL default 0,
  child_origin, child_destination, child_departure_date, child_return_date
  (NULL for parents), definition_snapshot_json NOT NULL (with the resolved
  window), trigger ∈ manual | schedule | tool, status ∈ pending | running | paused_budget | paused_error |
  interrupted | cancelled | completed | skipped_budget | skipped_confirm |
  skipped_window | skipped_missed, stage, estimate_json, cancel_requested, resume_after NULL,
  auto_resume_count NOT NULL default 0, created_at, started_at,
  finished_at, error_text, scheduled_for NULL (the firing the row stands for:
  the instant `croner` gives for that firing, as UTC ISO text with
  milliseconds; written by a scheduled start, catch-up or skip, and moved to a
  later firing only by that firing's punctual live-tick resume (decision 83),
  which can also give a paused manual run one; a catch-up's never moves, since
  History names it), is_catch_up NOT NULL default 0, browser_window_end NULL (the end
  of the run's browser window, §8.2), skip_code NULL
  (`half-cadence` | `browser-only-definition`, set only on a `skipped_missed`
  row, the reason it was not caught up), paused_at NULL (the instant the
  row last stopped running: set when it enters `paused_*` or `interrupted`,
  kept through a cancel, cleared when a resume claims it; a run the boot
  sweep finds lost stopped at its last ledger activity, else its start; §8.2
  reads it to tell a catch-up paused at a firing from one in flight there);
  migration 0007, which also adds the partial index
  `search_executions_in_flight_idx (created_at) WHERE status IN ('pending',
  'running')` (the one-probe read of `GET /api/executions/active`),
  `cell_outcomes.skip_detail` NULL (`catch-up-no-browser` |
  `outside-browser-window`, only with `skipped:scheduled_only`), the
  `browser_window` notification kind, and `app_meta`)).
  **Firing unique index** `(definition_id, scheduled_for) WHERE is_child = 0
  AND scheduled_for IS NOT NULL`, so one firing can never start or skip
  twice. A scheduled start or skip inserts with `INSERT … ON
  CONFLICT(definition_id, scheduled_for) WHERE is_child = 0 AND scheduled_for
  IS NOT NULL DO NOTHING` inside the start's immediate transaction (never
  `INSERT OR IGNORE`, which would also swallow the active-parent clash and
  CHECK or NOT NULL failures); when no row was inserted the start returns
  `firing-taken` and seeds no cells, launches nothing and sends no notice.
  **Parent partial unique index** `(definition_id) WHERE
  is_child = 0 AND status IN (pending, running, paused_budget, paused_error,
  interrupted)`; **child partial unique index** `(definition_id,
  child_origin, child_destination, child_departure_date, child_return_date)
  WHERE is_child = 1 AND status IN (the same active set)`. Index
  `(definition_id, started_at)`. `auto_resume_count` counts consecutive
  restarts without progress: reset when a tile or cell commits; not
  incremented by graceful SIGTERM. `resume_after` drives a one-shot croner
  job.
- `search_cells` (execution_id, origin, destination, departure_date,
  return_date, discovery_status NULL, discovery_reason NULL,
  discovery_min_pence, verification_selected, selection_reason,
  verification_status NULL, verification_reason NULL,
  verification_min_pence NULL, best_observation_id NULL FK
  `price_observations.id`, the cheapest observation written for the cell;
  "cheapest verified" is a read-time query because verdicts are read-time)
  PK five keys.
  A `NULL` status means the stage has no provider or no outcome rows yet.
- `cell_outcomes` PK **(execution_id, origin, destination, departure_date,
  return_date, stage, provider_id)** with status, reason, attempts NOT NULL
  default 0 (engine passes, not HTTP tries), last_error, fetched_at,
  min_pence, cabin, point_of_sale, source_kind, reused_from_execution_id
  NULL (always the execution that fetched the price). Seeded at start (§3). **Resume** selects, per `(stage,
  provider)`, outcomes with status `not_run`, or `error` with `attempts <
  3` and reason ∉ {auth, quota, parse, no-return-legs, no-priced-options,
  fx-unavailable, currency-unsupported, unknown-airport-tz}, or `skipped:budget` when
  headroom exists; a **manual** resume additionally selects
  `skipped:provider_disabled` and `error` with reasons auth/quota/parse
  (re-enabling the provider for that pass); never rewrites `priced | empty
  | no_data`, and no resume, manual, automatic or at boot, ever selects
  `skipped:scheduled_only`. Discovery resume re-plans tiles over the
  resumable cells only.
- `calendar_prices` (id, execution_id, provider_id, source_kind NOT NULL,
  cabin, origin, destination, departure_date, return_date, price_pence,
  price_native_minor, currency_native, fx_rate_nano NULL, fx_rate_date NULL,
  fx_source NULL, fx_converted NOT NULL, point_of_sale, fetched_at NOT NULL,
  provider_observed_at NULL, max_age_hours NULL, vendor_link NULL,
  reused_from_execution_id NULL, return_date_source NOT NULL ∈ vendor |
  asked | grid-cell, vendor_price_mark NULL ∈ cheapest | low | none). `return_date_source`
  (migration 0006) says where the row's return date came from: `vendor` (the
  vendor's response states it: Travelpayouts, SearchApi, fixture), `asked`
  (camoufox `list`: the date the worker asked for, checked against the search
  form) or `grid-cell` (camoufox `grid`: the cell's own, checked against the
  grid's return row); existing rows are backfilled `asked` for camoufox and
  `vendor` otherwise, and the column has no default, so every insert states
  it (a reused row keeps its source). `vendor_price_mark` is the
  vendor's own price mark: the grid's "cheapest price" (`cheapest`) or "low
  price" (`low`), relative to the view it was read from, and SearchApi
  `google_flights_calendar`'s `is_lowest_price` (`cheapest`); `none` where the
  vendor marks prices and marked this one not at all; NULL where the vendor
  states no marks (Travelpayouts, camoufox `list`, fixture). Insert-only; **one row per (execution,
  provider, cell)** (the engine reduces a tile to the minimum per cell with
  a deterministic tie-break and counts discards; an in-tile conflict
  throws); UNIQUE (execution_id, provider_id, cell keys). Indexes (origin,
  destination, departure_date, return_date, fetched_at), (origin,
  destination, fetched_at), (execution_id). History and route series read
  only `reused_from_execution_id IS NULL`.
- `itineraries` (hash PK, kind default 'flight', origin, destination,
  departure_date, return_date, nights, outbound_minutes, inbound_minutes,
  stops_out, stops_in, airport_change NULL, carriers_json, layovers_json,
  first_seen_at). Insert-or-ignore on hash.
- `segments` (itinerary_hash, direction, position, mode default 'air',
  marketing_carrier, operating_carrier, flight_number, from_iata, to_iata,
  depart_local, arrive_local, depart_utc, arrive_utc, duration_minutes,
  aircraft) PK (itinerary_hash, direction, position). No cabin: segments
  belong to the cabin-independent itinerary.
  Insert-or-ignore with the itinerary.
- `fare_offers` (id, itinerary_hash, provider_id, seller NOT NULL, cabin NOT
  NULL, first_seen_at, last_seen_at, first/lowest/highest/latest_price_pence)
  UNIQUE (itinerary_hash, provider_id, seller, cabin); `latest` = max
  `fetched_at`, tie `id`. Index (itinerary_hash).
- `price_observations` (id, offer_id, execution_id, source_kind NOT NULL,
  cabin, fetched_at NOT NULL, provider_observed_at NULL, price_pence,
  price_native_minor, currency_native, fx_rate_nano NULL, fx_rate_date
  NULL, fx_source NULL, fx_converted NOT NULL, point_of_sale,
  max_age_hours NULL (NULL = unknown; written explicitly from
  `CapabilityInfo.maxAgeHours`), taxes_included NULL, self_transfer NULL,
  segment_cabins_json NULL, baggage_json NULL, fare_conditions_json NULL,
  booking_json NULL {kind, url, postData?, host}, booking_expires_at NULL,
  supplied_fields_json NOT NULL, partial_expansion NOT NULL). Append-only. Indexes (execution_id, price_pence), (offer_id,
  fetched_at).
- Both price tables carry `CHECK ((fx_converted = 1) = (currency_native <>
  'GBP'))` and `CHECK (fx_converted = 0 OR (fx_rate_nano IS NOT NULL AND
  fx_rate_date IS NOT NULL AND fx_source IS NOT NULL))`; when unconverted,
  the repository asserts `price_pence = price_native_minor`. In
  `calendar_prices`, `max_age_hours` NULL means unknown and is written
  explicitly. The repository rejects any row where `provider_id =
  'fixture'` ⇔ `source_kind = 'synthetic'` does not hold.
- `provider_requests` (id, provider_id, execution_id NULL, endpoint_path,
  tile_index NULL, started_at, finished_at NULL, duration_ms NULL,
  http_status NULL, outcome ∈ pending | ok | error | unknown | cache_hit,
  billable NULL until finalised, cost_micro_gbp NOT NULL, http_attempt,
  page_class NULL ∈ page | no-page (camoufox only, migration 0005),
  scroll_count NULL (camoufox `grid` pages only: the scroll clicks the page
  made, ≥ 0, or the planned scrolls when an `unknown` call ended with no
  answer; NULL on every other row, camoufox `list` included, and on a grid
  call refused before any page; migration 0006)). Inserted at reserve.
  Index (provider_id, started_at, outcome, billable), (execution_id).
- `provider_cache` (key PK, provider_id NULL, body_json, stored_at,
  expires_at).
- `fx_rates` (date, currency, rate_nano, source) PK (date, currency).
- `alert_rules` (id, definition_id, type, threshold_pence NULL, pct NULL,
  basis, require_all_verified NULL, cooldown_hours NOT NULL default 336,
  enabled, deleted_at NULL). Soft-deleted; events are kept.
- `alert_events` (id, rule_id, identity_key, observation_id NULL,
  calendar_price_id NULL, dedup_key, fired_at, status ∈ sent | failed |
  suppressed, reason, payload_json). Index (rule_id, dedup_key, fired_at),
  (rule_id, identity_key, fired_at).
- `operator_notifications` (id, kind, execution_id NULL, definition_id,
  sent_at, status); `kind` is one of `OPERATOR_MESSAGE_KINDS` (migration 0007
  adds `browser_window`, §8.2).
- `app_meta` (key PRIMARY KEY, value; migration 0007): facts about the
  database itself, one row per known key. `app_instance_id` is a random id
  the app writes the first time it needs it, kept with `app_instance_path`,
  the database file's canonical path when the id was made (worked out by
  the repository itself, symlinks followed and the letter case the volume
  holds, so every opener agrees; read and written in one immediate
  transaction), and sends the
  `camoufox` worker as `x-gmt-app-instance` (decision 82). Opened at that
  path again (a restart, a container recreate, whose path is always
  `/data/…`, a host rename) it is the same app; opened at another path (a
  copied or moved file, a backup restored into a second app) it gets a new
  id, so a second ledger on the worker shows as a second instance.
- `route_price_history` (origin, destination, departure_date NULL,
  return_date NULL, cabin (a cabin or 'unknown'), provider_id, date,
  lowest_price_pence, fetched_at, point_of_sale) UNIQUE (origin, destination,
  departure_date, return_date, cabin, provider_id, date): the
  `price_insights.price_history` series SearchApi returns with a step-1
  response, which belongs to the **searched trip**, not the route, so each
  point is keyed by the cell's departure and return dates and the request
  cabin, and upserted on each verification. Only vendor-stated GBP points
  are stored (the repository refuses any other currency). Each point carries
  the provenance every price carries (§3): provider, source kind, fetch
  time, the point of sale of the search that returned it, and an FX status
  that is always "not converted". Rows written before the trip was recorded
  keep NULL trip dates (both or neither, by CHECK) and cabin 'unknown', and
  read "trip unknown"; rows written before the point of sale was recorded
  read point of sale 'unknown'. Shown on the History
  view as its own labelled series per trip ("Google's price history for
  5–15 Nov").
- `app_lock` (id = 1, holder ∈ app | tool, heartbeat_at, acquired_at).
  Heartbeat every 30 s; stale after 3 missed beats; liveness judged by
  heartbeat age, never by pid. Graceful SIGTERM releases the lock after the
  checkpoint. At boot, a fresh `tool` lock makes the app wait up to 60 s
  then refuse; a fresh `app` lock makes it wait up to 90 s, logging the
  lock age, then take over a lock that has gone stale and refuse one that
  is still being heartbeated (a second live app); the `HEALTHCHECK` `start_period` covers both waits. The tool
  bootstrap refuses while a fresh app lock exists; while the app is
  running, the same scripts are reachable as the authenticated routes
  `POST /tools/smoke` and `POST /tools/record` (§10). Acquisition and
  `reserve()` use `BEGIN IMMEDIATE`.

**Transactions.** Repository transaction callbacks are typed to return
non-Promise values and a db test asserts an async callback is rejected
(`better-sqlite3` commits at the first `await`). Atomic units: seeding
`search_cells` + discovery `cell_outcomes` at start; each tile's prices,
outcomes and roll-ups; selection persistence + verification seeding (resume
re-runs selection only when no verification outcomes exist); each reused
cell's outcome + copied prices + roll-up; a fresh price superseding a reused
row deletes that row in the same transaction; each verified cell's
itinerary, segments, offer, observation, outcome, `best_observation_id` and
roll-up; the boot `running → interrupted` update with its
`auto_resume_count` increment. Ledger finalisation happens in http-kit
(providers) **before** any engine write; the engine then writes outcomes in
its own transaction.

**SQLite settings.** `journal_mode=WAL`, `busy_timeout=5000`,
`foreign_keys=ON`. Opening a file database reads the journal mode back and
refuses anything but WAL (a file system that cannot hold WAL makes SQLite
keep its old mode silently); the app bootstrap exits 73. The app process is the only writer. The smoke and
recording scripts run through the **tool bootstrap**, a second entrypoint in
`apps/api` (WP4b) that reuses the same config parse and port wiring, opens
the same DB, skips the boot sweep, auto-resume and cron, uses the production
ledger, and honours `app_lock` (a test proves it starts no execution).
Graceful shutdown: `wal_checkpoint(TRUNCATE)`.

**Migrations.** Drizzle Kit SQL bundled into the image, applied at boot
idempotently. A `VACUUM INTO` backup runs first **only when migrations are
pending**, to a timestamped file under `/data/backups`, keeping the last 5
and refusing an existing target; **if the backup fails, migrations are
refused and boot fails** naming the cause. Seed after migration when `airports` is
empty or the dataset version changed.

**Retention.** A daily maintenance job deletes expired `provider_cache`
rows, prunes `cache_hit` ledger rows older than 90 days for providers on
monthly windows only (lifetime-window plans keep every row, since the cap
needs them) and logs DB size; expected growth per month is documented in
`docs/setup.md`.

**Budget windows.** Per provider from `<PROVIDER>_BILLING_DAY` (UTC, valid
1–28 so every month has the day); global from `GLOBAL_BILLING_DAY` (UTC,
default 1); `trial` plans use a lifetime window. `/budget` reports every
window's bounds.

## 8. Engine

### 8.1 Execution lifecycle
```
pre-start (scheduler tick and POST): resolve window (§6.1); estimate per provider and stage;
   for every scope check usage(scope) + estimate(scope) ≤ cap (execution calls, execution free calls,
   execution cost, each provider's month/lifetime, global month). A breach on a provider-specific or
   billed scope seeds that provider's cells skipped:budget and the run proceeds with the rest; only when
   nothing can run is the POST refused (409 naming the cap and numbers) or the scheduled run recorded
   skipped_budget + notified. Free providers therefore always run.
   estimate > SOFT_CONFIRM → POST needs confirmCostPence × 10 000 ≥ estimateMicroGbp;
   a scheduled run needs definition.confirmed_cost_pence × 10 000 ≥ estimateMicroGbp else skipped_confirm
   + notified; a PUT that raises the estimate above the stored confirmation returns needsConfirmation
start: snapshot; seed search_cells + cell_outcomes(not_run) for every cell × discovery provider; status=running
   (a catch-up, §8.2: camoufox's cells are reused as below and the rest seeded skipped:scheduled_only)
   a provider whose `cabins` excludes the snapshot's cabin is not called in either stage: its cells become
   no_data reason cabin-not-offered at seeding
discovery, per discovery provider, per (origin, destination) pair:
   reuse, per cell: the newest priced|empty|no_data outcome for the same cell, provider, definition,
          cabin, point of sale and source kind, from a non-child execution, with age measured from the
          original fetched_at < discoveryRefreshHours × 0.9, is copied with its calendar_prices row
          (original fetched_at, provenance, reused_from_execution_id = the fetching execution)
   plan = discovery.plan(q with cells = cells still not_run)   // re-planned over the subset
   for each tile (bounded pool = provider CONCURRENCY):
      fetchTile → 'tile'       ⇒ normalise (§5.6) ⇒ one price per cell ⇒ write atomically
               → 'tile-error' ⇒ covered cells error(reason = error.reason ?? kind), attempts+1
      errors per the table below
verification:
   selection (§6.7) persisted + verification outcomes seeded in one transaction
   bounded pool of cells (provider CONCURRENCY): verification.search → normalise → write atomically → priced|empty
   errors per the table below; on a stopping condition, abort sibling cells, return them to not_run, then set the status
alerts: evaluateAlertRules → persist events → notify digests
completed
```

**Error table (both stages, tested per row):**

| Event | Cell outcome | Execution |
|---|---|---|
| `ProviderError` rate-limit/upstream/network after retries | `error`, attempts+1 | continue |
| `ProviderError` parse | `error`, attempts+1; 2 consecutive for one provider (counted in ledger finalisation order) → provider disabled for the run, remaining cells `skipped:provider_disabled` | continue other providers; if none remain, `paused_error` + notify |
| `ProviderError` auth or quota on **any** call | provider disabled for the run; remaining cells `skipped:provider_disabled` | continue other providers; if none remain, `paused_error` + notify |
| `ProviderError` upstream with reason `no-return-legs` or `no-priced-options` | `error`, non-retryable on resume | continue |
| `ProviderError` blocked (`camoufox` only, §2) | `error` reason `blocked`, non-retryable on resume; provider disabled for the run, remaining cells `skipped:provider_disabled`, and kept disabled by a manual resume of that run | continue other providers; if none remain, `paused_error` + one notification per cool-down (keyed by its end), never one per run |
| `ProviderError` provider-unavailable (`camoufox` worker refused the connection) | `error` on that tile's cells; provider disabled for the run, remaining cells `skipped:provider_unavailable` | continue other providers; if none remain, `paused_error` + notify |
| Preflight refusal before a stage (`camoufox` cooling down or unreachable, §2) | every cell of the provider in the stage `skipped:provider_disabled` (cooling down until <time>) or `skipped:provider_unavailable`; no ledger rows | continue; one notification per cool-down |
| `BudgetExceeded` provider-execution (`camoufox` page cap) | remaining cells for that provider and stage `skipped:budget` | continue if another provider remains in the stage, else `paused_budget` + notify; needs a manual `/resume` |
| `BudgetExceeded` on a new reservation | the cell stays `not_run`; calls already reserved finish and write (plan decision 25) | `paused_budget` per §5.3; sibling calls are never aborted |
| `limiter-timeout` | cell returns to `not_run` | `paused_error` with `resume_after` = window reopen; a **one-shot croner job** resumes it at that instant (re-registered at boot, cancelled on cancel or manual resume) |
| `BudgetExceeded` provider-month / provider-lifetime, other providers remain in the stage | remaining cells for that provider and stage `skipped:budget` | continue; notify once; no one-shot job |
| `BudgetExceeded` provider-month / provider-lifetime, no other provider remains | remaining cells `skipped:budget` | `paused_budget` with `resume_after` = next cap window start; a one-shot job resumes it; exempt from the stale-run supersede while `resume_after` is in the future |
| `BudgetExceeded` global-month (billed providers only; free providers continue) | billed providers' remaining cells `skipped:budget`; in-flight billed siblings aborted → `not_run` | continue if a free provider remains, else `paused_budget` as above |
| `BudgetExceeded` execution-* | in-flight siblings aborted → `not_run` | `paused_budget` + notify; needs a manual `/resume`, which copies the definition's current `budget` into the snapshot (nothing else) and re-checks the caps |
| `AbortedError` (cancel / SIGTERM) | `not_run` | `cancelled` (operator) / `interrupted` (SIGTERM) |
| normalisation `fx-unavailable` / `currency-unsupported` / `unknown-airport-tz` / unmappable carrier | offers that fail are dropped and counted `offers-dropped:n` on a `priced` outcome; `error` with the reason only when no offer survives | continue |
| `BudgetExceeded` is never recorded as `error`. | | |

- **Estimate** = Σ discovery `plan(q with cells = non-reused cells).length`
  per pair, using the same reuse query as the run, + `maxCells ×
  verification.estimate`, all × `ESTIMATE_RETRY_FACTOR` (default 1.2; 1.0
  for camoufox, which never retries: its pages, scrolls and seconds are
  the plan's own), with
  assumptions in `notes`, plus `seconds` including limiter waits. Actuals
  come from the ledger by `execution_id` at any time and are labelled
  "ledger cost, from configured rates". **Parity** = distinct tile requests
  (first-attempt ledger rows + cache hits) for one uninterrupted pass =
  `plan` length; a parity break raises an operator notification and a View
  D flag. View D otherwise flags **overruns** only: usage above the
  **pre-factor plan** by more than 10% (the stored estimate already carries
  the 1.2 factor, so it is not the comparison baseline), judged on distinct
  tiles for discovery (its plan counts tiles, and a paged tile is one tile)
  and on calls for itinerary search; View D words each line by its unit.
- **Resume**: on `interrupted | paused_* | cancelled`, and on `completed`
  when `error` outcomes with headroom remain (retry-errors), continue per
  §7. Resume is a **compare-and-set**: `UPDATE … SET status = 'running'
  WHERE id = ? AND status IN (resumable)` proceeds only when one row
  changed, cancelling the one-shot job in the same step; the tick, the
  one-shot job, boot auto-resume and `/resume` all go through it, so
  losers no-op (or 409 for `/resume`). `/resume` also returns 409 if
  another execution is active. Before planning, `not_run`, `error` and
  `skipped` outcomes in either stage for cells with `departureDate ≤
  todayLondon` become `skipped:departed`, their attempts and `last_error`
  kept as evidence (an error on a flight that has left is not retryable;
  priced/empty/no_data rows are untouched). View D offers Retry only for an
  error on a cell that has not departed.
  Resume uses `estimateRemaining` (resumable tiles + remaining selected
  cells × estimate × factor) for its per-scope cap check, on both the
  tick and `/resume`. **Any** paused run older than `discoveryRefreshHours`
  whose `resume_after` is not in the future is cancelled and a fresh run
  started (the tick checks this before trying to resume). Manual `/resume`
  re-enables providers disabled in the previous pass; automatic resume does
  not.
- **Boot order**: `pending` executions older than the boot and `running`
  executions become `interrupted` (crash-marked rows increment
  `auto_resume_count`); if `AUTO_RESUME`, every `interrupted` execution
  with count ≤ `MAX_AUTO_RESUMES` resumes (never an execution whose
  definition is soft-deleted); one-shot jobs for `resume_after` are
  re-registered; **then** cron. Boot makes no network call. SIGTERM: stop scheduler, abort in-flight
  (cells → `not_run`), status `interrupted` without incrementing the
  counter, checkpoint, exit.
- **Staleness per price**: effective age (§3) vs `STALE_AFTER_HOURS`
  (default 192 = one weekly cycle + 24 h, verified basis) or, for calendar
  basis, `discoveryRefreshHours + maxAgeHours` of the provider (overridable
  by `CALENDAR_STALE_AFTER_HOURS`).
  Every row shows its effective age as a number; "stale" is reserved for
  older than one full refresh cycle. Stale rows are **returned and
  labelled, never hidden**; hiding is an opt-in filter. Ordering with
  unknown age: unknown loses to any known age; ties → verified; stale
  calendar prices still render, labelled.
- **Verified-basis results** mark rows whose cell has a later `priced |
  empty` verification outcome that did not include the offer as "not seen
  in latest search (<age>)" and rank them after seen rows.
- **Operator notifications** on `paused_*`, `skipped_*` (including
  `skipped_missed` when a missed firing is not caught up, §8.2; rows written
  before revision 36 read the same),
  `interrupted`, provider disabled, parity break, "alerts on calendar basis
  only"; deduplicated per execution and kind.
- **Single-cell verification** (`POST /cells/verify`): needs no parent;
  validates the cell ∈ `generateCells(current resolved space)` and airports
  exist; creates a child execution (`is_child = 1`, cell columns set) that
  skips discovery, `alwaysInclude = [cell]`, `maxCells = 1`, its own call
  cap (the cell's estimated calls × the retry factor, raised to
  `CHILD_MAX_CALLS`, default 6, and never above the headroom: the active
  parent's remaining calls, else the definition's `maxCalls`, less what the
  definition's other active children may still spend; a definition whose run
  cap is 0 billed calls therefore starts no child, the request refused with
  code `cap`; the other budget fields are inherited from the definition; the
  cell panel's verify confirms the hard stop it shows; a child never pauses: a
  cap breach ends it `cancelled` with the cell left unverified), shares the
  provider/global caps; at most one active child per cell; the action is hidden when the
  definition has no verification provider. Child observations are
  **included** in results, calendar-gap, View B counts and duration
  analysis (filtered to the current resolved space), counted separately as
  "+C on demand" beside "itinerary-searched K of N selected", where C counts
  completed children whose cell is inside the current resolved space and
  whose verification roll-up for it is priced, empty or no_data (the
  predicate K uses); children are
  excluded only from "latest execution", reuse sources and the parent
  index.

### 8.2 Scheduler
`croner` with `timezone: definition.schedule_tz`. Jobs are (re)registered on
create, `PUT`, disable, enable and delete, in the same request; a test
covers each. A tick, in order: cancel and supersede any paused run older
than `discoveryRefreshHours` whose `resume_after` is not in the future, and
any paused catch-up (the scheduled firing replaces it and starts with
`scheduled_for` set); else if an execution is `paused_error` with `resume_after ≤ now`, or
`paused_budget` and `estimateRemaining` now passes the cap check, **resume
it** (through the compare-and-set); else if any execution is active, record
nothing and show "schedule blocked since <date>" in the status bar (cleared
when a run of the definition starts, by a tick, a catch-up or by hand, or
once the blocking run is no longer active; the date is the blocking run's
own, so another run blocking later starts a new one); else
run the pre-start checks and start. A `paused_error` with no `resume_after`
(every provider disabled) blocks the schedule until a manual resume or the
supersede above. The definition's own `croner` job is the live tick.
`croner` 10.0.1 re-arms its timer at most 30 s ahead and, on waking from
sleep, fires an overdue firing once, so the tick computes its firing as
`previousFiring(expr, tz, now + 2 s)` (croner answers strictly before the
whole second it is given, so a tick at its firing's instant, or a timer that
fires within the second before it, counts as that firing; schedules fire at
most hourly) and writes that instant as `scheduled_for` for its start or
skip. When `now − firing` is over a 2-minute grace the tick is late: it still
runs the tick order above (the stale-run supersede, the resume, which then
does not re-anchor the browser window, and the "blocked since" record), and
in place of the start hands the firing to the catch-up decision below, for
which a run this tick just superseded does not cover the firing; so a late
tick is a catch-up under the same rules, and a machine asleep at every firing
still recovers from a stale paused run. The tick and the catch-up read the
one grace predicate, so a firing exactly 2:00.000 old belongs to the live
tick. A missed firing is caught up at most once. One function serves
the boot, the late tick and a system job that runs every minute while the
app is up (a native install keeps running through sleep, so waking is the
common case): for each scheduled definition it takes the latest expected
firing more than 2 minutes old (the grace lets a punctual live tick insert
its own row first), however old, and treats it as covered when the
definition changed after it, when a row already carries that firing in
`scheduled_for` (read first, through the firing index), when any parent
execution, manual and catch-up included, was active at that instant or
started after it, except a catch-up paused at it (its stored `paused_at` at
or before the firing), or when no configured provider that sells the
definition's cabin, the browser provider included, could run the definition
on a schedule (then nothing is written or sent). So a catch-up still in
flight at the next firing covers it like any run (an hourly catch-up that
overruns the next firing leads to no second one), and a paused catch-up
never covers a later firing: that firing's row, whatever it is (its start,
its catch-up or its `skipped_*` row), supersedes it in the same immediate
transaction as its insert, and a lost insert, or a cancel that finds the
catch-up already claimed by a resume, rolls everything back (nothing is
logged, nothing unscheduled). An automatic resume of a paused catch-up (its
one-shot at `resume_after`, the boot's auto-resume) first hands a firing
since its `paused_at` to this decision, past the grace at once and inside it
once the grace has passed (the resume is re-registered just after), and
resumes only if the catch-up is still paused afterwards; so the outcome is
decided from stored facts, whichever timer fires first after a wake, and
only a manual resume can carry a paused catch-up across a firing. A throw
while deciding is logged with the run and the resume goes ahead, so one
run can never stop the boot; once the engine is closing nothing resumes. Otherwise it is
judged against the catch-up's own provider set, which never loads browser
pages: when `camoufox` is the only discovery provider that could run the
definition on a schedule (a provider that does not sell its cabin cannot), the firing is recorded as `skipped_missed` with
`scheduled_for` and `skip_code` `browser-only-definition` (shown "only the
browser provider could run it, and a catch-up loads no browser pages"),
notified once, and nothing starts (not even a
verification-only run). A firing's cadence is the next expected firing
minus the missed one, both from `croner`, so irregular schedules (Monday and
Thursday, the 1st of each month, a daily time across a clock change) use
their own gap; an uncovered firing is not caught up when (next − now) <
(next − firing) / 2: it is recorded as `skipped_missed` with
`scheduled_for` and `skip_code` `half-cadence` (shown "the next scheduled run
was less than half the gap away"), shown in History with the firing and the
reason and notified once (when a notifier is configured). The code is
written with the row, so the Status view states the reason the firing had,
never one re-derived from today's settings. Otherwise one run starts through
the normal pre-start checks and caps, with `scheduled_for` the missed firing
and `is_catch_up` set. Every scheduled start or skip, tick or catch-up,
inserts through the firing unique index (§7), so the live tick, the boot and
the minute job can never start two runs for one firing, and every refusal a
catch-up can meet (a cap, a confirmation, the window, no runnable provider)
is that firing's `skipped_*` row carrying `scheduled_for`, recorded and
notified once and never retried. The minute job and the boot take each
definition apart from the others: one whose catch-up throws is logged and
the rest proceed, and the boot still registers its job. The engine's
shutdown, in order: refuses any start, resume or verification from its
first moment; stops every run taking new provider work (each stops as on
SIGTERM, its calls in flight ending as they do), so no provider request
starts while it waits; waits for the scheduler's callbacks already running,
such as a minute job sending its notice, at most the SMTP connection and
greeting timeouts plus 2 s (22 s, under the app's 25 s shutdown deadline);
then hands the database back. A callback still running past the wait
writes nothing more: a notice it sends late is logged once and its row is
not written, a skip disables no schedule, and a system job's network call
is aborted. The app marks the engine closed before it closes the database
in every case, so a shutdown cut off by the app's 25 s deadline is no
exception. A catch-up keeps the `camoufox` provider in
its snapshot for the reuse step only: reuse copies camoufox's own outcomes
that are still inside the refresh window with no page load, and its other
cells are seeded `skipped` with the reason `scheduled_only` and the detail
`catch-up-no-browser`, which no resume, manual, automatic
or at boot, ever runs; the next scheduled run fetches them as usual. A
catch-up therefore never loads browser pages; Travelpayouts and SearchApi
run as usual. **The browser window** (`CAMOUFOX_BROWSER_WINDOW`, §12; the
engine decides it, so it is not a shared worker setting; it is read live at
every check, so a change applies at the next check, and cells already
`scheduled_only` stay so). Under the default, `scheduled`, every other run
loads browser pages only inside its own window, whose end is stored on the
execution (`browser_window_end`, migration 0007). The start transaction
writes it as the run's anchor (the later of its firing, `scheduled_for`, and
its start, so a punctual tick that starts up to the 2-minute grace after its
firing never finds a small run's window already closed; a manual run the
operator starts is its own anchor, from its `started_at`) plus 1.5 × the
start estimate's total seconds. Nothing moves the end except a resume
performed by the definition's own punctual live tick: it re-anchors before
its window check, worked out in memory, so that firing becomes the run's new
anchor (the later of the firing and the resume) and the end is computed from
the estimate of the cells still resumable; `scheduled_for` and the end are
then written by one guarded statement inside the resume's claim transaction,
which changes nothing when another row already holds that firing (the pass
then carries on under the old window) and never touches a catch-up, so a
refused resume moves neither and the firing the operator chose loads
browser pages. A run with no stored end (one started before
migration 0007, or with no estimate) ends at its `started_at` (else
`created_at`) plus `STUCK_AFTER_HOURS`. The window is checked only at three moments: (a) before a run's first
`camoufox` page, (b) at any resume (by the operator, by its `resume_after`
job, by the boot's auto-resume, or by its definition's live tick), and (c)
before the next `camoufox` page after the machine has slept; (a) and (c) run
when the provider's rate limiter admits the page, immediately before it is
sent, so a page that waited for its slot across a sleep is checked when it
would really start and, refused, is abandoned with nothing reserved or sent.
Sleep is
detected, not inferred from page timing: the engine's scheduler module keeps
one heartbeat timer (every 30 s, unreferenced so it never keeps the process
alive, beside the minute job) that records the last wall-clock beat; a beat
arriving more than 120 s after the previous one means the process was
suspended, so it records `suspendedAt` (the previous beat) and `resumedAt`,
logs one line, and marks every execution in flight as needing a window
check. Before each `camoufox` page starts, a last beat older than 120 s also
counts as a detected suspension, which closes the up to 30 s after a wake
before the next beat arrives. A page in flight during the suspension finishes, its result kept with
its provenance unchanged, and the check runs before that run's next page. A
run is never otherwise cut mid-flight, so runs sharing the worker,
interleaving page by page and each taking longer than its estimate, keep
their tails. A resume checks the window
before it prices or cap-checks anything: past the window, the provider's remaining
cells are first written `skipped` with the reason `scheduled_only` (detail
`outside-browser-window`), so the pass, its stored estimate and its cap check
leave `camoufox` out, and a `camoufox` monthly cap cannot refuse a resume
that SearchApi and Travelpayouts can run. A run past its window at check (a)
or (c) does the same with its remaining cells; a page already loading
finishes, and the operator is told
once for that run, in a notice kind of its own (`browser_window`, so its
dedupe and a `provider_disabled` notice's never hide each other): "browser
pages left: this run is past its browser window", naming who fetches the
cells as §3's texts do. SearchApi and Travelpayouts resume and continue as
usual, and the next scheduled run (on a definition with no schedule, the
operator's next run of it) fetches the browser provider's cells. A pass the
window cut left its planned tiles unrequested on purpose, so it is no parity
break, and View D offers no Retry on a browser error a resume would only
leave (the resume's own rule). So browser pages load near the times the operator chose, and never
late; the Status view warns when two definitions that use the browser
provider share a firing time and suggests staggering them. Under `any`, a
run resumed by the operator, by its `resume_after` job or by the boot's
auto-resume, or carrying on after the machine slept, keeps loading browser
pages whenever it resumes, within every cap, the spacing and the
cool-downs, and no window check writes `scheduled_only`. A catch-up never
loads browser pages under either value: the gate refuses a catch-up's
browser page outright, whatever its cells' state, and a resume of a catch-up
leaves any runnable browser cell `scheduled_only` (`catch-up-no-browser`).
A catch-up's prices carry the usual provenance (their fetch time is when
they were fetched), and History shows "ran <time>, catch-up for <missed
time>" beside each price a catch-up fetched, whatever definition ran it (the
api names each point's catch-up), and lists a skipped firing with the time it
was due and its reason. Cron is
a bounded string in `core/api-contract`; the single `parseCron` wrapper in
`engine` (over `croner`) is the **sole** semantic validator, imported by
`api` (sub-hourly rejected, tz validated); `core` has no cron parser.

**Cadence arithmetic** (and `docs/scheduling.md`), from the same functions
as the estimate, for the worked example's 4 pairs over a 182-day window,
under the §5.2 tilings measured by the spike:

| Config | Per run | Per month (weekly) | Fits |
|---|---|---|---|
| £0 Travelpayouts, `month` tiles | `O × D × M` free calls (worked example 28; 34 with the 1.2 retry reserve) | ~148 (34 × 4.33 weekly runs; every weekly firing refetches, since 168 h is past the 0.9 × 168 = 151.2 h reuse threshold; ~121 before the reserve) | yes, cap 50,000; usefulness is whatever the coverage check reports for the pairs |
| SearchApi $40, weekly discovery, `maxCells 10, expandTop 2, bookingLinks true` | ~21 tiles per pair + `maxCells × 5` (worked example ~84 + 50 = ~134) | see `docs/scheduling.md` (generated) | yes: ~£32 subscription, marginal cost 0; the call cap is the hard stop; headroom for `maxCells` ~200 (~1,084/run planned) or daily runs (~2,330/month with the reserve: discovery refetches once per weekly refresh, at most 5 times a month, and itinerary searches run daily) |
| SearchApi trial | one discovery exceeds 100 | — | spike and smoke only; scheduled runs exclude SearchApi on `trial` |

There is no built-in definition with airports in it. The Definitions form
starts with empty origin and destination fields and a plan-aware **policy
preset** (`trial`/£0: Travelpayouts discovery only; `40usd`: both providers,
`maxCells 10, expandTop 2`); execution caps come from the plan preset.
`docs/setup.md` carries the London → New York example as importable JSON. `budgetFit` at save time
compares `runsPerMonth × estimate` with every cap and warns. The
`discoveryRefreshHours` comparison uses a 10% tolerance (reuse iff age <
0.9 × refresh) so a weekly cron refreshes weekly; tested at 151 h, 152 h and
a DST-shortened interval.

### 8.3 Notifications
`EmailNotifier` (nodemailer, `SMTP_*`, all or nothing; `SMTP_TLS = implicit
| starttls | none`, where `starttls` sets `requireTLS` and `none` is
permitted only for the dev Mailpit profile or a loopback host, else boot
refuses) and `LogNotifier`. Plain text only. Alerts are sent as digests
(§6.8). Subject:
`[get-me-there] £412 LHR→JFK 14 Mar–28 Mar (14n) · Google Flights via SearchApi · fetched 5h ago · 1 constraint unverified`
or, calendar basis, `… · Aviasales cache · fetched 2h ago · provider age unknown (≤7d before that) · constraints not checked`.
Body: segments (or "calendar price, no itinerary"), verdicts naming every
unverified constraint, provenance line with effective age, link (validated
`https`, host shown, expiry state; for POST bookings a link to the app's
results row instead), coverage caveat "itinerary-searched K of N cells, E
outbounds each", the rule. Provider strings CRLF/control-stripped.
Synthetic refused. The banned-word test (§11) runs over rendered notifier
output and API reason strings with word-boundary matching.


**Consent expiry.** The app evaluates the Status view's consent check (§10) on the
03:30 maintenance job and, so that a machine asleep at 03:30 still sends, on the
minute job (which re-reads the check at most hourly while the day's notice is
unsent). While the check is `warn` or `fail` for a cause it can name and the
browser provider is enabled, it sends one consent-expiry notice a London day to
every notifier, as the notifier message variant `{ kind: 'system', subject,
body }` through one engine helper, `sendSystemNotice`. The subject comes from
the cause, never the state: "expires soon" (30 days or less left), "has
expired", "has no consent record", "consent screen is now shown" (a voided
not-shown record); a check that cannot be made (the worker is down, refused the
key or answered something unreadable) sends nothing, because the worker card
says that. The body gives the check's summary, one sentence of consequence
("Browser prices stop when consent lapses; the other price sources are
unaffected.") and the fix in its own sentence. The day's key
`consent-expiring:<London date>` in `operator_notice_keys`, the store the
camoufox cool-down notice uses, is claimed only after a notice was sent, so a
failed send is tried again on the next pass; an in-flight flag stops two passes
sending twice. It is not an `OperatorMessageKind` (that union feeds
`OPERATOR_MESSAGE_KINDS`, the `operator_notifications` kind check, and needs a
definition id), so `operator_notifications`, its CHECK and the drizzle snapshot
are untouched; there is no separate reminder service.

---

## 9. Testing
Thresholds in each package's `vitest.config.ts`, enforced in CI from WP0:
`core` 100% lines/branches/functions; `db`, `providers`, `engine`, `api`
85% lines and 70% branches; `web` 70% lines, 60% branches. Mutation
testing (Stryker) on `core` `hashing`, `constraints`, `selection`,
`rollUp`, `syntheticAllowed`, `toGbp`, `vendorUrl` and `alertDedup` with a
break threshold of 80%, run in Stryker's sandbox (never in place) with
explicit timeouts and concurrency 2; the gate fails when timed-out mutants
exceed 5% of those tested (a timeout counts as detected, so load must never
pass it), and CI runs it in a workflow of its own, on demand and weekly,
never on every push. Recorded vendor responses never enter git, so the
suites that replay them skip in CI by title; their local run, on a machine
that holds the recordings, is the gate for any change to a provider adapter
or the engine. First-failing-test per WP in §16.

1. **`core`**: §6.1 incl. relative windows, clamping, zero-cell windows,
   `startOffsetDays = 0` rejection, DST/TZ matrix; §6.2 every constraint,
   each with absent input → `unverified` (table-driven), and
   `verdictClass`; §6.3 `toGbp` (rounding, zero, large, CNY/JPY reference
   values, direction), non-integer rejection, timestamp format rejection;
   §6.4 matrix incl. `4U`, unmappable carrier, unknown tz; §6.6 precedence
   table enumerated independently, property invariant, monotone merge;
   §6.7 every interaction, stride edge cases (`m ≤ 0`, `total < m`); §6.8
   both bases, dedup, cooldown, calendar identity, digests, sparse-cache
   drop rule, 1,000 calls × 3200 micro-GBP = 320p trips a 300p cap;
   `syntheticAllowed` truth table incl. traversal and symlink cases; vendor
   URL validation; the label formatter.
2. **`providers`** (`msw` on global fetch): tiles partition cells and
   `plan().length` equals msw hits exactly; response-date keying drops
   out-of-band entries; empty-is-per-capability (Travelpayouts empty
   envelope → `no_data`, SearchApi empty grid → `parse`); `has_no_flights` →
   `noFares`; currency read from the response and a non-GBP response asserts
   conversion and the FX flag; `suppliedFields` populated from **recorded**
   fixtures only; parameter names and values match the dated allowlist;
   error mapping incl. `Retry-After`, 403, quota discrimination,
   per-request timeout, limiter-timeout; backoff with fake timers; pipeline
   order (cache hit → zero upstream, non-billable row, original `fetchedAt`;
   dedup → one call; reserve before fetch each attempt; `BudgetExceeded`
   before mock hit); `auth`/`quota`/`parse` never retried; abort mid-fetch
   finalises `unknown`, still counted by `usage()`, no retry; token
   responses never cached; egress allowlist and 302 test; recorder fails
   closed on secret substring and replaces tokens with placeholders so
   chains replay; sentinel-key test; fixture-tree tests (every committed
   fixture scanned; recorded files carry `recordedAt`, `recordedBy` and a
   content hash that the test recomputes, so a hand-edited file fails;
   synthetic files carry `synthetic:true`; loaders refuse the wrong tree);
   fixture gates incl. negatives; the fixture adapter's host allowlist is
   `fixture.local` only.
3. **`db`**: migrations; async transaction callback rejected; rollups
   atomic; `latest` ordering; UNIQUE keys; cap predicates (pending/unknown
   counted; billed vs free execution scopes; zero-cost passes a 0 cap;
   global cap includes the fixed fee once; lifetime window; **1,000 ledger
   rows at 3200 micro-GBP trip a 300p cap in SQL**); compare-and-set resume
   claim (two concurrent claimers, one wins); boot sweep; resume
   query per (stage, provider) with the manual-resume extension; roll-up
   precedence incl. row 0; soft delete; `app_lock` symmetry and stale
   takeover; the provider⇔kind check; FX CHECK constraint.
4. **`engine`**, two layers. **Layer A (WP7)**: the fixture provider as an
   HTTP adapter at `fixture.local` served by `msw` on global fetch, through
   the real http-kit and the real `db` `BudgetGuard` with the fixture cost
   rule, in-memory DB; this layer covers everything vendor-agnostic below.
   **Layer B (WP13, after 4b/5/6)**: the real adapters replaying recorded
   fixtures through the same path. Layer A: seeding; every
   row of the §8.1 error table in both stages; tile-error marks exactly its
   cells; reuse per cell copies prices with original `fetchedAt`, never
   copies error/not_run, refuses on a cabin change; a fresh price
   supersedes a reused row; interrupt after k of n tiles then resume
   re-plans only tiles with resumable cells and ledger rows = n; cancel mid
   expansion → `not_run`, no itinerary; concurrency 4 with 1 call left → 1
   billable call; stopping breach aborts siblings → `not_run`; SIGTERM then
   reboot resumes without incrementing the counter; crash-loop cap; pending
   sweep; boot order; refresh tolerance at 151/152 h and a DST interval;
   `departed` on resume; alert dedup across executions on both bases;
   digests; synthetic refused by alerts and notifiers; child execution
   rules and inclusion in results; scheduler re-registration on
   edit/disable/delete; one-shot resume jobs; paused_budget resumed at
   window start; `fx-unavailable`, `currency-unsupported`,
   `unknown-airport-tz`, `offers-dropped`.
5. **`api`**: every route against `core/api-contract` with provenance
   required on every price-bearing response; verdicts recomputed at read
   time after a constraint edit; stale rows returned with `stale: true`;
   `notSeenInLatest`; default basis per §6.9; auth gate incl. static and
   `/health` split, failed-auth rate limit, password length; Host/Origin/
   Content-Type checks; security headers; the §5.5 boot matrix with injected
   config **and** one test spawning the real bootstrap with a real
   production environment asserting that `/providers` omits `fixture`, that
   constructing the fixture provider throws, and that a synthetic repository
   write throws; cron validation; `/cells/verify` membership; `truncated` +
   `total`; `/tools/*` routes require auth.
6. **`web`**: View B states incl. partial-day five-way marker and
   per-basis colour scale with hatched fallback days; View D sums; a price
   lacking provenance fails to render; synthetic banner present and absent;
   distinct text and ARIA for pass/fail/unverified; keyboard operation;
   375px assertion that price, provenance **and the class badge** stay
   visible; banned-word test with word boundaries and an allowlist over
   web, engine templates and API strings; booking links render with
   `rel="noopener noreferrer"`, host shown, POST bookings as forms, no
   auto-navigation; chart empty and loading states. One Playwright smoke in
   fixture mode.
7. **Live scripts** (excluded from `pnpm test`, run via the tool bootstrap):
   `pnpm smoke:live` issues exactly one tile per configured provider (a
   query sized so `plan` yields one tile), asserts via the ledger, prints
   the cheapest price with provenance and, for an itinerary price, its time
   each way and stops (it applies no definition constraint), writes dated
   fixtures, exits non-zero
   on zero providers configured or any configured-provider error, distinct
   exit code for `empty`. `pnpm record:fixtures --budget N` records the step
   1→2→3 chain for one cell and the 429/quota bodies when the vendor can be
   induced to return them, within an explicit call budget.
8. **Build**: a Dockerfile assertion for `NODE_ENV=production` and
   `IN_CONTAINER=1`.
9. **Local operation** (work packages 16–18): every `gmt` command is a pure
   planner from its inputs (OS, environment, existing files and their modes,
   answers) to a list of actions (make a directory, write a file with its
   mode, download and verify, unpack, rename, run an argv), run by an
   injectable executor: an in-memory fake for unit tests and a real one
   tested against a temporary directory. Tests assert the plans, an
   idempotent re-run, the refusal on a differing file, stop-at-first-failure
   with its report, and, with sentinel secrets, that no secret (raw, as
   base64url or inside an export line) reaches any plan description,
   rendered service file, log line, error message, standard error or output
   other than `consent export`'s one line. Data-loss paths run for real in a
   temporary directory: a SQLite database with rows backed up by
   `scripts/backup.mjs`, imported or restored, reopened and counted, and
   interrupted at each step to show the database is the old one or the new
   one, never partial. The launchd plist and the systemd units have snapshot
   tests plus property tests (the parsed `ProgramArguments` equals the argv;
   `ExecStart` round-trips paths with spaces, quotes, `%` and `$`), and are
   checked by `plutil -lint` and `systemd-analyze --user verify` in the
   matching CI jobs. Mutation testing (break threshold 80%, in the mutation
   workflow) covers the planners, the executors' file-mode logic, the secret
   generator, the answers schema, the Camoufox install planner, the consent
   line codec, the status aggregation and its state rules (`core`), the
   catch-up rule (`engine`, its own Stryker config) and the worker's monthly
   admission; a check fails when a file a brief names for mutation is in no
   Stryker `mutate` glob, when a brief states no mutation scope (an empty
   one included), or when a merged brief still lists a pending one. The
   `consent` command runs against
   a loopback fake consent page through a driver type exposing only launch,
   load, read cookies, read the URL, snapshot and close: Reject all, Accept
   all refused, `SOCS` with no consent page, a consent page left unclicked,
   a challenge page, offline, window closed, no consent screen, an account
   cookie. `GET /api/status` has contract, redaction and per-state tests
   (table-driven, every row and state counted) and a route test over a
   migrated database with global `fetch` throwing except for the worker's
   loopback URL; the Status view a component test per state. `apps/cli`
   holds 85% lines and 70% branches.

**CI matrix.** The `test` job (lint, typecheck, the unit suites and the
visible-skip check of recording-dependent suites) runs on `ubuntu-24.04`,
`ubuntu-24.04-arm`, `macos-15` and `windows-2025`. On Windows, POSIX-only
tests skip with a visible title naming the reason, and the tests known to
fail there are listed in `ci/windows-known-failures.txt`, one
`<relative file> > <full title>` a line: the leg runs vitest with its JSON
reporter and a script in `scripts/` compares the results with the list
(each listed failure still printed with its title), is not
`continue-on-error`, and turns red on any failure outside the list or on a
listed test that passes, so the list only shrinks; a guard over `vitest list
--json` refuses a line naming no test, a line matching two, and a duplicate
line. An
`install-e2e` job on both Ubuntu runners and `macos-15` clones the checkout
into a temporary directory on a local `main` whose `origin` is a bare
repository, runs `gmt setup --non-interactive` there from a generated
answers file (no vendor key, a non-default port), asserts the installed
state (the unit or agent present and running, health 200), runs `gmt status`
(exit 0, with `backups` `ok`, its newest backup (setup's) under 36 h old and
no note, and the "no usable price source" warning), pushes a commit to
the bare repository and runs `gmt update` (the served version changes), runs
`gmt uninstall`, and asserts the listed removed paths are gone and the kept
ones remain. Each matrix entry declares its mode as a literal, `E2E-MODE:
real` or `lint-only`, echoed by the job and parsed by the workflow guard,
which fails on a computed mode and when no entry is `real`; `lint-only` is
allowed only for a runner WP16b's research records as unable to run its
service manager, with the run link and date in the brief. The job has a
timeout and uploads the service logs on failure. Windows runs `gmt setup
--dry-run`, which there prints the refusal and exits 0 (a real `setup`
exits 78). A `camoufox-install` job, on changes to `CAMOUFOX_BUILDS` or the
install code and weekly, downloads each runner's entry (cached by its
SHA-256, one retry, a step timeout; an Intel macOS runner covers
`darwin-x64` if one is available, else that entry is stated as not
exercised in CI), checks the hash, and launches it headless through the
worker's own launch path against a loopback page, with a `fetch` spy proving
`camoufox-js` never reached its download branch and, on Linux, the generated
`FONTCONFIG_FILE` in place. No CI job loads a Google page, calls a vendor or
reads a repository secret; the one outbound call a booted app makes is its
free FX-rate fetch, which is never ledgered. `scripts/workflows.test.mjs`
parses every workflow and fails on the `secrets` context in any form,
`github.token` or `GITHUB_TOKEN` in the install jobs, `pull_request_target`,
`workflow_run`, `secrets: inherit`, a self-hosted runner, a missing
top-level `permissions: contents: read`, an action not pinned by SHA, or a
URL whose host is off its allowlist (`registry.npmjs.org` and loopback for
every job; `github.com` and its release-asset hosts for the two install
jobs only), in the workflow YAML and the `ci/*.json` files its steps name;
each ban has a fixture that fails.

---

## 10. HTTP API
Schemas in `core/api-contract`; every route is mounted under `/api` (the SPA
owns `/`; the table omits the prefix); errors `{ error: { code, message,
details? } }` where a 422 carries `details.fields[]`; every price-bearing
shape carries `provenance` and `stale`.

| Route | Purpose |
|---|---|
| `GET /health` | unauthenticated and exempt from the Host allowlist: `{ ok, degraded }` where `degraded` = job count ≠ enabled scheduled definitions, or an execution running past `STUCK_AFTER_HOURS`, with no detail; authenticated detail `{ db, providers, scheduler: { jobCount, nextRun, lastExecutionAt, degraded } }` |
| `GET /status` | authenticated; never spends, never waits on a vendor, never loads a page: `{ generatedAt, mode: 'native' \| 'container' \| 'dev', version, checks }`, each check `{ id, area, providerId, label, state: 'ok' \| 'warn' \| 'fail' \| 'off', summary, note, offReason, fix: { text, command } \| null }` (`label` names a card among several of its area, a search's name; `note` an aside on any check, such as "caught up the run missed at 01:30, ran 07:02", which never counts toward the status bar; `offReason` ∈ `not-set-up`, `not-visible`, `awaiting-verification`, `disabled` (a disabled search, so a parked one never nags the bar), only when `off`; nothing a state rests on is ever truncated), worst first; `command` is a `pnpm gmt …` line in native mode and always null in container and dev mode, where the text names the compose action or the docs section; areas `app`, `database`, `backups`, `schedule`, `data` (per definition, its latest finished parent run's discovery coverage per cell in the six buckets with their spec labels, both ends of its priced observations' effective ages, never "fresh", "complete" or "all"), `provider` (one per provider plus `price-sources`, which warns "no usable price source" unless a non-synthetic provider can price a scheduled search), `worker` (whose card also states the app's `CAMOUFOX_BROWSER_WINDOW`; a worker that answers but will refuse pages is `fail`, judged by the same rule as the engine's preflight: a signed-in profile, shared settings that differ, an unverified or differing grid setup), `consent` (a capture's date is stated as an upper bound, "expires by … at the latest", when the worker does not report the cookie's own expiry), `email` (the newest send of any kind since the app started: alert digest, notice or test; `fail` when it failed); a provider card's auth or quota class is the adapters' own, recorded on the ledger row where the call is classified (migration 0008, `error_kind`), and a 2xx whose body was rejected is not a success; summaries come from fixed templates and error classes, never from vendor, worker or SMTP text; the worker check reads the worker's `/v1/status` through http-kit with a 2 s timeout and picks named fields (`workerStatusSchema` gains a field one work package before any worker emits it, so an app parses the status of a worker one package newer); no field carries a key, password, database path or `SOCS` value |
| `GET /executions/active` | authenticated: `{ execution: { id, definitionId, definitionName, kind: 'run' \| 'cell-verification', startedAt, estimatedFinishAt } \| null }`, the oldest execution with a pass in flight (pending or running), a parent run or a single-cell verification (which spends credits too), read as one row; its estimated finish is now plus the seconds its remaining cells are estimated to take (so a resumed run never reads as finished in the past), or null without an estimate; `gmt update` reads it |
| `POST /alerts/test-email` | sends one fixed test message through the configured email notifier, apart from `ALERT_EMAIL_MAX_PER_HOUR` (a test has its own limit of one a minute and an in-flight guard, so pressing it never crowds out an alert; 429 past it); 409 when email is not configured; the class of the send (sent, failed; never the server's text) is kept in the notifier and shown as "since the app started" |
| `GET /airports?q=` | airport-table autocomplete: up to 20 rows `{ iata, name, city, country, tz, metro }` |
| `GET /providers` | capabilities, plan, usage vs caps with window bounds for the one window each plan uses (the month on a monthly plan, the lifetime on the trial; the unused window is not sent, so a null cap means no cap); "verification will not run: spend cap is 0" when a provider whose calls cost money is enabled under a zero spend cap; on a billed plan whose calls cost £0, a `capNote` naming the call cap that is the hard stop |
| `GET/POST/PUT/DELETE /definitions[/:id]` | CRUD; `POST` with no body creates the **default definition for the configured plan**; response includes `budgetFit`; `PUT` re-registers the schedule; a zero-cell window returns 422 |
| `POST /definitions/estimate`, `POST /definitions/:id/estimate` | for an unsaved body or a saved definition: cells, per-provider calls (pre-factor and factored), cost (micro-GBP and pence), seconds, assumptions |
| `POST /definitions/coverage-check` | body: origins, destinations, window, nights; runs Travelpayouts month tiles (free, ledgered, subject to the free-call caps) and returns cached rows per pair per month; never calls a billed provider |
| `POST /definitions/:id/executions` | pre-start checks; `confirmCostPence?`; 409 on active execution or cap breach naming the cap |
| `GET /executions/:id` | status, stage, reason, `resumeAfter`, progress per stage × provider, budget usage for every scope (each provider in the one window its plan uses), estimate vs ledger (updates during run) |
| `POST /executions/:id/cancel`, `/resume` | `/resume` 409 if another is active or the compare-and-set loses; manual resume re-enables disabled providers and, on a `completed` execution, retries `error` outcomes with headroom |
| `POST /cells/verify` | validated cell → child execution; 409 if a child is active for that cell |
| `GET /definitions/:id/results?basis=&executionId=&limit=` | `{ rows, total, truncated, basis, basisReason, executions: [{ id, status, age }], coverage }`; default basis per §6.9; one row per itinerary (§6.5 dedup) from this definition's executions **including children**, filtered to the current resolved space and cabin, verdicts recomputed, **all verdict classes returned**, ranked by class then price so `failed` rows never consume the cap ahead of better ones, stale labelled, rows carry `notSeenInLatest`; calendar basis per §6.9; cap 1000 with `truncated`. **No sort or filter parameters**: sorting and filtering are client-side (§6.5) |
| `GET /definitions/:id/calendar?destination=` | per day: discovery counts per provider in the six buckets `{ priced, empty, no_data, error, skipped, not_run, reused }`, verification `{ selected, itinerarySearched, onDemand }`, `cheapestVerified` (class verified only, incl. children), `cheapestPartiallyVerified` with count, `cheapestCalendar`; all in the definition's cabin. With `destination`, every count and minimum is that destination's alone (plan decisions 53, 58: there is no basis parameter and no per-destination breakdown) |
| `GET /definitions/:id/duration-analysis` | per nights: `minVerified` (class verified, with n, incl. children), `minCalendar` per provider with n |
| `GET /definitions/:id/coverage` | summary, per-provider request counts (tiles and calls), overrun and parity flags, "selected but not reached", errors with retry (only on cells that have not departed), and the on-demand children with their own buckets and calls |
| `GET /definitions/:id/calendar-gap` | cells whose calendar price is below the cheapest class-`verified` observation (incl. children); empty when the definition has no verification provider |
| `GET /definitions/:id/cells/:origin/:destination/:departureDate/:returnDate` | that cell's outcomes per stage and provider and its prices, each with full provenance (the View B side panel source) |
| `POST /tools/smoke`, `POST /tools/record` | the live smoke and recording scripts run inside the app process (authenticated), for use while the app holds `app_lock`; the response's `searchApiCreditsLedgered` is the smoke's running total (the SearchApi credits tool runs had already ledgered in the window at its spend check, null before that check and for `record`), which `gmt smoke` prints and confirms |
| `GET /tools/smoke/plan` | authenticated, ledgers nothing: the smoke's worst case from `smokeWorstCase` (SearchApi credits split into calendar and itinerary, Travelpayouts free calls, browser pages and, in grid mode, the scroll allowance) and the SearchApi trial credits left, which `gmt smoke` prints before it asks |
| `GET /itineraries/:hash/history`, `GET /routes/:o/:d/history?cabin=` | series per provider and kind; the route's calendar series has one point per execution fetch (the pair's minimum across its cells, carrying the cheapest cell); reused rows excluded; the vendor's price-history series comes grouped by searched trip (`trip` = its departure and return dates, null for rows stored before the trip was recorded), each point vendor-stated GBP |
| `GET/POST/PUT/DELETE /alerts[/:id]`, `GET /alerts/events` | |
| `GET /scheduler/jobs`, `GET /budget` | |

---

## 11. Web UI
**Banned words everywhere (the one canonical list, tested with word
boundaries and a small allowlist over web, engine templates and API
strings):** "exhaustive", "all combinations", "every combination", "live",
"bookable", "guaranteed", "real-time". Use "fetched 12m ago", "Google
Flights via SearchApi" (itinerary search), "Google date grid via SearchApi"
(calendar), "Google Flights prices via Camoufox" (the `camoufox` provider, compact
mark `CF`), "Aviasales cache", "estimate vs ledger". The word "verified"
appears only beside class-`verified` values; the `verified` basis is
labelled "itinerary-search basis"; stage counts say "itinerary-searched".

Layout: nav owned by WP9 for all views, its links wrapping into rows on a
phone so every view stays in sight; definition selector; **status bar**
on every view (it reads `GET /status` through the same query as the Status
view, every 60 s: any `fail` shows a "Status: n failing" link, any `warn` a
quieter "Status: n to check" link, each naming the area when there is one
("Status: consent to check"); a `degraded` app is a `fail` on `schedule`;
after a failed refresh the bar shows "Status: stale, checked N min ago" and,
with no report, "Status: app not answering", never a clean state from old
data): stage, progress as the six-bucket breakdown per stage ×
provider (never an "attempted" or "searched" umbrella), spend used / cap
for the execution and the month, and each provider's call usage against
its binding window, worded as the Providers view words it ("this month:
Travelpayouts 2 of 50000 calls", "SearchApi 7 of 24 calls over the plan's
lifetime"), paused state with reason and Resume, "schedule blocked since
<date>", Cancel. On a phone the numbers fold for a finished run and stay
open while a run is active or paused. Every view header: execution(s) shown, status, age, stale label,
banner when not completed. The Results header is two lines: **"cheapest
found £X · <destination> <dates> · <basis> · <verdict class> · <provider> ·
<age>"** and **"discovery: P priced · E no fares · X no cached data · R
error · S skipped · U not searched of M (R′ reused) · itinerary-searched K
of N selected (E outbounds each) +C on demand"**, linking to Coverage
("outbound" agrees with E; a run that selected nothing beside on-demand
searches reads "itinerary-searched C cells on demand; none selected by the
run"). When more than half the counted cells are "no cached data", Results
and Calendar add one line naming the next move: add SearchApi discovery,
widen the airports, or run the coverage check. Empty state for no
providers. Red synthetic banner (§5.5).

**Provenance on every price, visible without hover**: provider badge,
source in words, effective age in the `core` compact row format ("2h ago ·
≤7d", or "age unknown") with the full form on hover and in headers, "≈" when
FX-converted, dashed outline + "constraints not checked" for calendar
prices, destination airport. Where a cell is too small for the row form
(the desktop calendar day, the phone day face, the 375px Results row) the
face still shows the provider's short mark, the destination, a short age
line from `core` ("5d old", "≤2d old", "age unknown", or the "vendor's
cache age unknown" badge) and, on a calendar price, "not checked"; the
title attribute may carry the long form, never the only form, and these
faces keep their tested contrast and their fit at 375px. Every such face is
a variant of `PriceCell`, never a second price renderer: `PriceCell`
validates the complete provenance (provider, source kind, fetched and
observed time, point of sale, FX status) before it prints an amount, and a
face keeps "≈" on a converted price. Point of sale is validated on every
price and shown, in words from `core` ("UK market" for GB, "market not stated"
for `'unknown'`, otherwise the code and "market"), on the full price displays:
the Results rows and header, the cell detail panel, Duration, History and the
alert events table, and on the alert email's provenance line, because the same
flight can be priced differently by market. It is not a face item: the compact
calendar face and the phone face leave it out, so the 375px widths do not change.
It is one install-wide setting (§12 `POINT_OF_SALE`), or `'unknown'` where the
vendor ignores it. Each row also carries the operator's per-destination note from
the definition (free text such as "onward leg not included") on every row
for that destination. Optional operator-entered onward cost per destination
renders as an "adjusted" column, labelled operator-entered, sortable, never
merged into price.

- **Definitions form** (one screen): origins and destinations entered by
  the operator with airport-table autocomplete (no preset airports); a
  **coverage check** button that runs the free Travelpayouts month tiles
  for the entered pairs and shows cached rows per pair before saving;
  per-destination note and onward-cost fields; defaults for everything
  else: relative window offset 7 days, length 182; 10–21 nights; economy;
  `maxJourneyMinutes` 1500; arrival 06:00–23:00 local; providers and
  policy from the plan preset (§8.2) with `discoveryRefreshHours` 168,
  `maxCells 10, topN 10, expandTop 2, bookingLinks true` (forced for
  SearchApi); execution budget from `EXECUTION_MAX_CALLS` /
  `EXECUTION_MAX_FREE_CALLS` / `EXECUTION_MAX_COST_PENCE`; schedule
  `0 5 * * 1` in `SCHEDULER_TIMEZONE`. The creation screen shows the
  estimate and the operator's "create" click is the explicit confirmation
  that sets `confirmed_cost_pence = ceil(estimateMicroGbp / 10 000)`.
  Advanced fold for constraints and policy. An "import example" action
  loads the JSON from `docs/setup.md`. The £0 path needs a three-line
  `.env` (`TRAVELPAYOUTS_TOKEN`, auth user, auth pass).
- **View A Results**: columns in order: price (+ provenance), total travel
  time, departure, return, nights, destination, carriers, stops, verdict
  class badge, fetched-ago, provider, adjusted (if configured). At 375px the
  primary row keeps price, provenance, **the class badge**, dates and stops;
  the rest moves to the expanded row. Expanded row: segments, layovers,
  baggage, conditions, every verdict, booking (GET link with host, POST
  form button, or "no link"), and the search link. Sorting and filtering
  are **client-side** over the fetched page with the shared pure functions,
  composing without refetch; when `truncated` the header says "within the
  cheapest 1000 of N". Filter and sort state persists across views.
  `bandCheapest` marks the cheapest row per 6h travel-time band. Calendar
  rows show the "not applied: …" note. Banner (only when a verification
  provider is configured): "N cells have calendar prices below your
  reference verified price (latest seen, then fresh, then cheapest) (£X)"
  with per-cell verify.
- **View B Calendar**: day shows, by precedence, the cheapest class-verified
  price under `STALE_AFTER_HOURS`, else the fresher of a stale verified and
  the cheapest calendar price (labelled; unknown age loses to known), else
  glyphs. Colour by **one basis at a time** on a quintile scale over the
  visible days of that basis; fallback days are hatched, excluded from the
  scale, and the legend says which basis each day uses. Marker: "P priced ·
  E no fares · X no cached data · R error · S skipped · U not searched of M"
  for discovery, and "itinerary-searched 1 of 10 selected +C on demand"
  separately. The day face names the buckets that apply ("12 no cached
  data", "3 priced, 9 no cached data"), with a striped mark when part of the
  day was not searched; it never shows a "searched" fraction or a "fully
  searched" mark, which would make a day of cache misses read as covered.
  Distinct glyphs for `empty`, `no_data`, `error`, `not_run`, each with its
  count on the phone face too; numeric legend, the dashed-outline key
  always open. Per-destination filter. Side panel with cells, outcomes,
  verify.
- **View C Duration**: bars per nights with axis titles (nights, £); series
  "min among verified (class verified, n=…)" and calendar per provider; `n`
  in label and tooltip; explicit empty and loading states; gaps for
  unsearched nights; no interpolation.
- **View D Coverage**: counts per stage × provider with the six-bucket
  breakdown and "searched" as the umbrella beside it (the one view that
  shows it); selected but not reached with reason; overrun and parity
  flags; error list with retry; below the latest parent run, the on-demand
  itinerary searches, each with its own buckets and ledger calls.
- **History**: one series per provider and kind; x = `fetchedAt` for
  provider series and the point's own `date` for the vendor's price-history
  series from `route_price_history`, one per searched trip and named by it
  ("Google's price history for 5–15 Nov", or "trip unknown"; points share
  one fetch time and are vendor-stated GBP, never marked "≈"); gaps;
  reused rows excluded; axis titles; empty state. The route view says
  itinerary offers are shown per itinerary, from a Results row; "run"
  counts parent runs, with on-demand searches counted apart.
- **Status**: one card per `GET /status` check, grouped by area, worst first,
  each a labelled region whose state is written as text before its summary
  (never colour alone); "checked N s ago" from `generatedAt`; on a failed
  refresh the last report stays, marked stale with its age, and with no
  report the view says the app is not answering, as `gmt status` does. Every
  card not `ok` shows its fix; a fix command has a copy button that confirms
  "Copied", and where the clipboard is unavailable (a non-secure origin) the
  command is shown selected instead. `off` cards fold into one line that
  says why each is off ("not set up: SearchApi"; "awaiting verification for
  this build: browser provider"); container-mode backups keep a card of their
  own ("not visible from the container: check your host's backup job,
  docs/setup.md section 6"). Provider cards use the Providers view's wording
  and link to it. Refreshes on focus and every 60 s; read only, except the
  email card's "Send test" (`POST /alerts/test-email`), disabled while
  sending, with distinct messages for sent, not configured (409), hourly
  limit (429) and failed. Settings are not edited here.
- **Definitions / Alerts / Providers**: forms with estimate, `budgetFit`,
  standing confirmation, onward-cost entries, plan presets shown.
- **Accessibility**: 375px layout as above; keyboard-operable table and
  calendar; visible focus; labelled controls; no colour-only meaning;
  numeric legend on the heatmap.

Charts follow the `dataviz` skill.

---

## 12. Configuration
Parsed once in `api` bootstrap through the `core` zod schema; empty = unset;
invalid or half-set config fails boot naming the field; nothing defaults to
unlimited. Plan presets fill caps, rates, TTLs and costs; individual
variables override. The full preset table (every field per plan) lives in
`docs/api-limits.md` and the zod schema.

```
# For the container, write only the lines you set. NODE_ENV, IN_CONTAINER, DATABASE_PATH, PORT and BIND_ADDRESS are
# fixed by the image and docker-compose.yml; ALLOW_UNAUTHENTICATED and ALLOW_FIXTURE_PROVIDER are not forwarded by
# compose (docs/setup.md sections 2 and 3). The development-only lines are marked below.
# --- core ---
NODE_ENV=production                      # production | development | test (test refused by the app bootstrap)
DATABASE_PATH=/data/get-me-there.db      # realpath-resolved at boot; .fixture.db required with ALLOW_FIXTURE_PROVIDER
PORT=3000
BIND_ADDRESS=0.0.0.0                     # container binds all; compose publishes 127.0.0.1:3000; non-loopback requires auth
ALLOWED_HOSTS=                           # Host allowlist; default derived from PORT: localhost:<port>,127.0.0.1:<port>
APP_BASE_URL=                            # optional https URL of this app, used for links in email; empty = relative links
APP_BASIC_AUTH_USER=                     # both or neither; required in the compose path; password ≥ 12 chars
APP_BASIC_AUTH_PASS=
ALLOW_UNAUTHENTICATED=false              # only for Tailscale-only hosts
TRUST_PROXY=false                        # read the client IP from X-Forwarded-For (reverse-proxy deployments)
LOG_LEVEL=info
POINT_OF_SALE=GB                         # ISO 3166 country for the vendors' point-of-sale parameters; base currency is fixed at GBP in this build
STALE_AFTER_HOURS=192                    # verified basis: one weekly cycle + 24 h
CALENDAR_STALE_AFTER_HOURS=              # optional override; default = discoveryRefreshHours + provider maxAgeHours
STUCK_AFTER_HOURS=12
MAX_CELLS_PER_DEFINITION=50000
SCHEDULER_TIMEZONE=Europe/London         # default schedule_tz for new definitions (single source)
AUTO_RESUME=true
MAX_AUTO_RESUMES=3
MAX_WAIT_SECONDS=3900                    # limiter queue deadline and Retry-After ceiling; above an hourly window
REQUEST_TIMEOUT_SECONDS=60
ESTIMATE_RETRY_FACTOR=1.2
FX_MAX_RATE_AGE_DAYS=3
# --- spend (operator writes pence; code holds micro-GBP) ---
MONTHLY_SPEND_CAP_PENCE=                 # total monthly spend incl. subscription fees; empty = preset default (0 with no billed provider, 3500 on 40usd); 0 = no billable calls; free providers still run
GLOBAL_BILLING_DAY=1                     # 1–28
SOFT_CONFIRM_PENCE=100
EXECUTION_MAX_CALLS=                     # billed calls per execution; preset default (trial 0, 40usd 2000)
EXECUTION_MAX_FREE_CALLS=2000            # free-provider calls per execution
EXECUTION_MAX_COST_PENCE=                # preset default (trial 0, 40usd 0: marginal cost is 0 on a subscription plan)
CHILD_MAX_CALLS=6
# --- travelpayouts (authorised, cached, free; schema defaults: cap 50000/mo, 200/min, 10000/h, concurrency 4, TTL 6h, cost 0) ---
TRAVELPAYOUTS_TOKEN=                     # enables the provider
TRAVELPAYOUTS_BILLING_DAY=1              # 1–28
# overrides: TRAVELPAYOUTS_MONTHLY_CALL_CAP, _RATE_PER_MINUTE, _RATE_PER_HOUR, _CONCURRENCY, _CACHE_TTL_HOURS
# --- searchapi (scraping-derived; see docs/providers.md) ---
SEARCHAPI_KEY=                           # enables the provider
SEARCHAPI_PLAN=trial                     # trial (100 lifetime, 20/h, 2/min, concurrency 1, cost 0, fixed 0; excluded from scheduled runs)
                                         # | 40usd (subscription: 10000/mo call cap is the hard stop, 2000/h, 10/min, concurrency 2,
                                         #   marginal cost 0 µGBP/call, fixed 3200p counted once in the global cap; sets MONTHLY_SPEND_CAP_PENCE=3500,
                                         #   EXECUTION_MAX_CALLS=2000, EXECUTION_MAX_COST_PENCE=0 unless overridden)
                                         # a per-call plan would set _COST_PER_CALL_MICRO_GBP > 0 and fixed 0; none is offered today
                                         # 100usd is above the approved ceiling and needs every value set explicitly
SEARCHAPI_BILLING_DAY=1                  # 1–28
SEARCHAPI_CACHE_TTL_HOURS=1              # local cache window; the vendor does not bill a cached repeat (spike fact 4) but its window is undocumented
SEARCHAPI_TRIAL_USED=0                   # trial only: seed for the lifetime window when the trial was partly spent elsewhere; above 0 on 40usd fails boot
# overrides: SEARCHAPI_MONTHLY_CALL_CAP, _RATE_PER_MINUTE, _RATE_PER_HOUR, _CONCURRENCY, _COST_PER_CALL_MICRO_GBP, _PLAN_FIXED_PENCE
# the hourly rate is clamped to 20% of the call cap, the vendor's own hourly rule
# --- camoufox (self-scraped Google Flights, list mode, discovery only, off by default; see docs/providers.md and §2) ---
CAMOUFOX_ENABLED=false                   # true only with the host-side worker running; false = the provider does not exist
CAMOUFOX_WORKER_URL=                     # http://127.0.0.1:8090 (pnpm dev) or http://host.docker.internal:8090 (app in Docker; the compose default); loopback or host.docker.internal only, explicit port, no path
CAMOUFOX_WORKER_KEY=                     # ≥ 32 chars, shared by app and worker; required when CAMOUFOX_ENABLED=true
CAMOUFOX_MIN_SPACING_SECONDS=30          # start to start; 0–600 (0 means no pause: pages go back to back, still one at a time, from your own address); never randomised; a shared setting, kept equal in worker.env (a difference skips the provider)
CAMOUFOX_EXECUTION_PAGE_CAP=100          # page loads per execution (BudgetExceeded provider-execution), frozen into the execution's budget snapshot; 1–400
CAMOUFOX_MONTHLY_PAGE_CAP=1500           # page loads per billing month (provider-month; no-page rows not counted); the app's ledger enforces it; the worker reports it (and enforces it from WP17)
CAMOUFOX_BILLING_DAY=1                   # 1–28: the month starts 00:00 UTC that day, for both monthly caps (the ledger's, and the worker's from WP17)
CAMOUFOX_COOLDOWN_HOURS=48               # pause after a challenge, sign-in or consent page; 24–100000 (an unrecognised page pauses a fixed 1 h)
CAMOUFOX_PAGE_TIMEOUT_SECONDS=90         # the worker's whole-page deadline (load, settle, read), 30–240; the app's request timeout is this + 15 s
CAMOUFOX_MODE=list                       # list (one day pair a page) or grid (the Dates tab's date grid, once the worker reports GRID_VERIFIED and its measured step)
CAMOUFOX_GRID_SCROLL_SPACING_SECONDS=5   # grid: scroll clicks start to start; 0–30 (0 means no pause: scrolls go back to back); never randomised
CAMOUFOX_GRID_SCROLL_CAP=30              # grid: scrolls a page may make; 0–60
CAMOUFOX_EXECUTION_SCROLL_CAP=600        # grid: scrolls per execution, checked before every page's scrolls; 0–6000
CAMOUFOX_MONTHLY_SCROLL_CAP=6000         # grid: scrolls per billing month; the app's ledger enforces it; the worker reports it (and enforces it from WP17)
CAMOUFOX_BROWSER_WINDOW=scheduled        # exactly scheduled (default when unset: pages only inside a run's window, §8.2) or any (a resumed run keeps loading pages, within every cap, spacing and cool-down); any other value fails boot naming the field; app side only, not shared with the worker; a catch-up loads no browser page either way
# worker side only (macOS; Linux from WP17; its one 0600 env file <workerData>/worker.env, written by gmt setup; docs/setup.md §14): CAMOUFOX_WORKER_KEY, CAMOUFOX_WORKER_PORT, and the shared settings named under "Where settings live" below
# fixed, not configurable: concurrency 1, rate per hour = floor(3600 / spacing) (no rate limit at spacing 0; the page caps still bound a run), cost 0, cache never
# --- email (all or nothing) ---
SMTP_HOST=
SMTP_PORT=
SMTP_TLS=implicit                        # implicit (465) | starttls (587, requireTLS) | none (dev Mailpit or loopback only)
SMTP_USER=
SMTP_PASS=
ALERT_EMAIL_TO=
ALERT_EMAIL_FROM=
ALERT_EMAIL_MAX_PER_HOUR=20                # outgoing email ceiling per hour, counted per process lifetime (a restart starts a fresh hour); digests and operator messages share it; only sent or in-flight emails count, a failed send does not; messages beyond it are logged and dropped
# --- set by the Dockerfile, never by the operator ---
# IN_CONTAINER=1
# --- never in production; development only, not passed by compose ---
ALLOW_FIXTURE_PROVIDER=
```

**Where settings live.** In the container, `.env` beside
`docker-compose.yml`, as above. In native mode (§13) the app reads
`~/.config/get-me-there/app.env` (the directory 0700, the file 0600 and the
user's own), passed by the service as `node --env-file=<path>`, so no value
reaches the plist, the unit or a command line; the service starts with an
environment holding only `PATH` and `HOME`, so nothing inherited overrides
the file. It holds the same names as `.env` plus `NODE_ENV=production`,
`DATABASE_PATH` (the absolute path of
`~/.local/share/get-me-there/get-me-there.db`), `BIND_ADDRESS=127.0.0.1` and
`PORT`. `gmt setup` renders the file, parses it back with `node:util`'s
`parseEnv` (the parser behind `--env-file`, which the worker's `run.ts`
already uses), requires the result to equal what it meant to write, and
checks it through the same `core` schema the app parses; generated values
use only `[A-Za-z0-9_-]`, operator values are double-quoted, and a value
holding `"`, `\`, CR or LF is refused. Every reader (`gmt status`, `gmt
password`, `gmt smoke`) uses the same `parseEnv`. Lines the operator added
by hand under names the wizard does not own are kept values, not a
difference. The worker keeps `<workerData>/worker.env`, where `<workerData>`
is always `~/.local/state/get-me-there/camoufox` (the CLI ignores `XDG_*`
for the worker's two directories, so the CLI and the worker always agree);
`gmt setup` generates one `CAMOUFOX_WORKER_KEY` and writes it to both files,
and keeps the settings the two sides must share equal:
`SHARED_WORKER_SETTINGS` in `core/camoufox/settings.ts`
(`CAMOUFOX_COOLDOWN_HOURS`, `CAMOUFOX_PAGE_TIMEOUT_SECONDS`,
`CAMOUFOX_MIN_SPACING_SECONDS`, `CAMOUFOX_MODE`,
`CAMOUFOX_GRID_SCROLL_CAP`, `CAMOUFOX_GRID_SCROLL_SPACING_SECONDS`,
`CAMOUFOX_MONTHLY_PAGE_CAP`, `CAMOUFOX_MONTHLY_SCROLL_CAP`,
`CAMOUFOX_BILLING_DAY`, `POINT_OF_SALE`), beside `workerDataDir(home)`, the
one rule for `<workerData>` that the worker, the CLI and the app's status
check share. One rule set in `core` holds each shared setting's bounds,
default and refusal words (`CAMOUFOX_COOLDOWN_HOURS` 24 to 100,000 on both
sides), and the app's config, the worker's `loadWorkerConfig` and the CLI's
file reader read these names only through it (`readSharedSettings`, with
`effectiveSharedSettings` for a record that must be valid), deriving every
typed field from its one record, so no second reader or default exists.
Each side compares **effective** values: the value after its default is
applied, integers as decimal strings, so a line left out on one side and set
to the default on the other is not a difference. The
worker reports its record as `sharedSettings` in `/v1/status`. One pure
`sharedSettingDiffs(app, worker, mode)` in `core` serves the provider's
preflight, the Status view's worker check, the CLI's writer and `gmt
status`; it names settings, never values, and compares the two grid-only
names (`CAMOUFOX_GRID_SCROLL_CAP`, `CAMOUFOX_GRID_SCROLL_SPACING_SECONDS`)
only in grid mode. Any name it returns makes the preflight skip the
provider (`provider_disabled`, "settings differ: <names>") in either mode,
and the Status view's worker check fails naming it. A worker too old to
report `sharedSettings` is compared on the fields it does report, as
before. The two keys are
compared by digest and reported only as "keys differ"; `gmt setup
--reconfigure browser` asks whether to generate a new key (yes by default
when they differ) and then stops both services, writes 24 random bytes as
hex to `worker.env` and then `app.env` (each through a 0600 temporary file and
a rename), and starts the worker and then the app; a run interrupted midway
leaves "keys differ", which a re-run repairs. `gmt start` and `gmt status` check both files' modes and owner; a
file readable by others is a `fail` naming the `chmod`.

On subscription plans the **call cap is the hard stop**, the marginal cost
per call is 0, and the global cap and `/budget` count
`SEARCHAPI_PLAN_FIXED_PENCE` once, so `MONTHLY_SPEND_CAP_PENCE` means total
monthly spend and the £35 ceiling is visible. A zero spend cap stops only a
call that costs money: boot warns, and `/providers` says verification will
not run, when a provider whose calls cost money is enabled under a zero
cap; on a plan whose calls cost £0 the call cap is the only stop, and the
Providers view names it. Boot also warns, naming
`MONTHLY_SPEND_CAP_PENCE`, when that cap is below the subscription fees it
counts, and logs one line naming each configured provider's plan, window
and schedule exclusion. With neither auth variable set on a non-loopback
bind, the refusal names the two `.env` lines to add.

---

## 13. Deployment and operations
`Dockerfile`: multi-stage; `node:22-slim` pinned by digest;
`NODE_ENV=production` and `IN_CONTAINER=1`; `pnpm install --frozen-lockfile`
with pnpm 12 `allowBuilds` (better-sqlite3, esbuild) and the prebuilt fetch made
**fail-closed** (no source-build fallback; version pinned by the lockfile;
integrity recorded in the WP12 brief); migrations, the vendored airports
dataset and `scripts/` copied into the runtime image; `USER node`;
`.dockerignore` excludes `.env*`, `data/`, `fixtures/recorded/`,
`node_modules/`; the Dockerfile creates `/data` owned by `node` before the
volume is declared so a fresh named volume inherits the ownership;
`HEALTHCHECK` as a `node -e` fetch of `/api/health` with a `start_period`
covering migrations, backup, seeding and the `app_lock` waits (§7). The
repository `.gitignore` covers `.env*`, `data/`, `*.db*` and `backups/`, and
CI runs the secret scan over `fixtures/`.

`docker-compose.yml`: `app` with a **named volume** for `/data` (bind mounts
on Docker Desktop have WAL locking caveats, documented; bind only for
copying backups out), `ports: 127.0.0.1:3000:3000`, an explicit
`environment` allowlist (never `ALLOW_FIXTURE_PROVIDER` or `NODE_ENV`),
`BIND_ADDRESS=0.0.0.0`, `restart: unless-stopped`, `stop_grace_period:
30s`, `logging` options (`max-size`, `max-file`), no `env_file` (it would
forward every line of `.env`); boot fails with a clear message if `/data`
is not writable; `mailpit` under the `dev` profile serves the host-side
`pnpm dev` process (`SMTP_HOST=127.0.0.1`, `SMTP_TLS=none`); the container
always uses real SMTP.

**Backup**: the `db` package's backup routine, exposed as
`scripts/backup.mjs` (`VACUUM INTO` + `PRAGMA integrity_check` on the
output, refusing an existing target; a failure refuses migrations)
runs pre-migration when migrations are pending and on demand via `docker
compose exec`; the live smoke is invoked from the host with
`curl -u … -X POST http://127.0.0.1:3000/api/tools/smoke` (the image has no
curl); docs give a
host cron example with retention, how to copy out of the named volume, and
an off-box copy. **Restore**: stop; delete `*.db-wal` and `*.db-shm`;
replace the `.db`; start. Restoring resets month-to-date spend: lower caps
and reconcile with the vendor dashboard.

**Local dev**: `pnpm dev` (api + web hot reload, `./data/dev.db`), `pnpm
smoke:live`, `pnpm record:fixtures`, `pnpm test`. Docs: `setup.md`
(first-run path: auth first, then `ALLOWED_HOSTS` for every hostname users
type with Tailscale and reverse-proxy examples, TLS termination, expected DB
growth), `api-limits.md` (preset table, per-provider facts, reconciliation),
`scheduling.md` (cron examples, cadence table, pausing).

**Native local mode (the default local path; work packages 16a and 16b).**
`pnpm gmt setup` in a checkout on macOS or Linux installs the app as a user
service: a launchd agent `local.get-me-there.app` in `~/Library/LaunchAgents`
on macOS, a systemd `--user` unit `get-me-there-app.service` on Linux. Every
service runs the Node binary setup ran under (`process.execPath`, recorded; a
path inside a temporary or shim directory is refused), never `pnpm` or
`corepack`, with an environment of `PATH` and `HOME` only; the app runs as
`<node> --env-file=<app.env> <checkout>/apps/api/dist/bootstrap/start.js`
(`NODE_ENV=production`, bound to `127.0.0.1`, basic auth on). It restarts on
failure no faster than once a minute (launchd `KeepAlive` on an unsuccessful
exit and `ThrottleInterval` 60; systemd `Restart=on-failure`, `RestartSec=60`)
and stops on SIGTERM with a 30 s grace (launchd `ExitTimeOut` 30, systemd
`TimeoutStopSec=30`), so the app always checkpoints and releases `app_lock`.
Installing a service is idempotent: an unchanged file plans nothing; a
changed one is rewritten and reloaded (launchd `bootout` if loaded, then
`bootstrap`; systemd `daemon-reload`, then `enable --now` or `restart`), and
any change to `app.env` plans a restart. `gmt status` and `gmt start` flag a
service whose Node binary or checkout no longer exists, with `pnpm gmt setup`
as the fix, and `update` re-renders the units. On macOS the services run
while the user is logged in (a Mac that must run unattended needs automatic
login; a LaunchDaemon is out of scope), and setup detects a missing GUI
session (`launchctl print gui/<uid>` failing, as over SSH) and says so. On
Linux, setup probes the user manager with `systemctl --user
show-environment`, telling "no user bus" (log in through a proper session,
or set `XDG_RUNTIME_DIR=/run/user/<uid>`) from "no systemd"; for a machine
nobody stays logged in to it runs `loginctl enable-linger <user>` without
`sudo` (answers field `linger: skip | enable`), and on refusal prints the
exact `sudo` command for the operator to run: `gmt` never runs `sudo`. Logs:
on macOS `~/Library/Logs/get-me-there/` (0700), which `gmt status` warns
about past 100 MB, with the `newsyslog` line to rotate it in the docs; on
Linux the user journal, where setup notes when the journal is not persistent
(`/var/log/journal` absent) and `gmt logs` prints a hint when it shows
nothing (journal group membership). Data lives in
`~/.local/share/get-me-there/` (the database 0600, `backups/` 0700,
`camoufox/`), settings in `~/.config/get-me-there/` (§12), and the worker's
state in `~/.local/state/get-me-there/camoufox/` as before. A daily backup
job (a launchd calendar agent; a systemd timer with `Persistent=true`) runs
`<node> --env-file=<app.env> scripts/backup.mjs --dir
~/.local/share/get-me-there/backups/daily --keep 14`, in its own subdirectory
so the app's pre-migration backups (kept at `BACKUPS_KEPT`, 5) never prune
it; setup takes the first one before it finishes, and `gmt backup` takes one
by hand. These backups sit on the same disk as the database: they protect
against a bad update or a deletion, not against losing the disk, so copy the
folder elsewhere (Time Machine includes it) for that. If the operator opts
into the browser provider on a machine whose `<os>-<arch>` flags are set, a
second service runs the worker (`<node> --conditions=@gmt/source --import
tsx <checkout>/apps/camoufox-worker/src/run.ts main`, in that package's
directory; `local.get-me-there.camoufox-worker`,
`get-me-there-camoufox-worker.service`). It is installed and started only
once its start checks pass (`gmt start` runs `run.ts check --json` first, a
result in `startRefusalSchema`'s terms), and a refused start never restarts
every minute: systemd's `RestartPreventExitStatus=78` stops it, and on macOS,
where launchd's `KeepAlive` cannot exclude one exit code, the worker's agent
has `ThrottleInterval` 600 and `gmt start`, `gmt status` and `gmt update` boot
the agent out while `start-refusal.json` is present, reporting "refused, not
retrying". The worker writes that file (0600, inside its 0700 data
directory; `{ reason, at }` in `startRefusalSchema`, no free text) before
exiting 78 and clears it on a successful start. There is no separate
reminder service (§8.3).

**One app per ledger.** Two apps on two databases would each enforce the
caps against their own ledger. Docker stays the VPS path, unchanged, and
native setup refuses while a compose project `get-me-there` exists, running
or stopped (`docker compose -p get-me-there ps -a`), or its volume does
(`docker volume inspect get-me-there_gmt-data`), unless `--import-docker` or
`--ignore-docker` is given, and where the `docker` command exists but the
daemon does not answer it says "start Docker so setup can check for an
existing compose app, or pass --ignore-docker". `--import-docker` reads the
container app's `GET /api/executions/active` (with the compose `.env`'s
credentials) and refuses while a run is active, as `update` does (`--wait`
waits for it), reading again immediately before the stop; stops the container
gracefully; takes the backup from the
stopped volume with `docker compose run --rm --no-deps --entrypoint node app
scripts/backup.mjs --dir /data/backups`; copies the printed file out (then
0600, the user's own); restores it as the native database and checks it with
`PRAGMA integrity_check`; and only then writes `MOVED-TO-NATIVE` beside the
old database (`docker compose run --rm --no-deps --entrypoint sh app -c …`),
offers `docker compose down` (the volume kept; with the marker, a later
`docker compose up` or a reboot makes the container exit 78 in a loop until
then), and offers to carry the compose `.env`'s settings and vendor keys into
`app.env` with confirmation, whole groups read through `core`'s config parse:
the vendor lines with their caps (`SEARCHAPI_TRIAL_USED` with the SearchApi
key: the trial's count of credits spent outside any ledger lives in the
settings, never in a database, so no import carries it in the database), email,
the time zone and market, and the spending caps and run settings. The import
applies in phases, each a real plan its `--dry-run` prints (the backup's file
name is known only after it runs): build first, prepare, the guard again, stop
and back up, place and mark, then start; each failure says what state it left
and how to recover (before the marker: the native database unchanged, `docker
compose start app` brings the old app back; after it: the database is in
place, the old one marked, and a plain `pnpm gmt setup` finishes). A failed
restore leaves no marker. Before the native app first starts on the imported
database, setup states what that start resumes and catches up. It refuses
over an existing native database unless `--replace-database`, which passes
the same run guard, says that the replaced ledger's month stops counting
toward the caps, and backs that one up first. `--import-db <path>` does the
same for a database a checkout's `pnpm dev` or tool bootstrap used, after
reading its lock without taking it (`scripts/lock-state.mjs`, since the CLI
never imports `@gmt/db`; only an absent or stale lock is free), and writes the
marker beside it; it refuses the native database's own path.
`--ignore-docker` stops the Docker app and writes the marker into the compose
volume without importing, saying so where it is chosen. The app and tool bootstraps honour a `MOVED-TO-NATIVE` file beside
whatever database they open, inside a container or not, before migrations,
the boot sweep, auto-resume and cron: they exit 78 with "this database moved
to a native install on <date>; see docs/setup.md section 0" (the marker's one
format, `core`'s `movedMarkerText` and `parseMovedMarker`: its first line is
the move's instant, ISO UTC; the date shown is that instant's, else the file's
modification time's, in Europe/London; a marker that exists but cannot be
read still refuses, its date unknown), which also
names the line that removes the marker (`docker compose run --rm --no-deps
--entrypoint rm app /data/MOVED-TO-NATIVE`). `gmt status` reports a compose
`app` container running beside the native service. The worker enforces its
own monthly page and scroll caps across every caller (§2) and reports a
second app instance in a month: each app sends its database's own random
`app_instance_id` (§7 `app_meta`, kept with the database's path), so a
container recreate or a host rename is still one app, and a second ledger,
a copied or moved database included, is a second instance. With two apps on one SearchApi key, the stop
is the vendor's quota, not this app's ledger, and the money ceiling still
holds only because the `40usd` plan has no overage (`docs/api-limits.md`
states this, and a docs test pins it).

**The `gmt` command** (`apps/cli`, `pnpm gmt <command>`): `setup`
(interactive; `--non-interactive --answers <file>` for CI; `--dry-run` prints
the plan; `--reconfigure <group>` with the groups `port`, `timezone`,
`email`, `travelpayouts`, `searchapi`, `browser`, `password` and `linger`,
each replacing only its own lines, saying what changed, and restarting the
app only when something did; `--import-docker`, `--import-db <path>`,
`--ignore-docker`), `status`, `start`, `stop`, `restart`, `logs`, `backup`,
`restore <file>`, `password`, `smoke --from <IATA> --to <IATA>`, `consent` (with
`export`, `import` and `check`), `update` and `uninstall`. Each command
computes a plan of actions behind one `Platform` interface (its paths, its
user id, `writeSecretFile`, and a `ServiceManager` whose facts are gathered
once before planning and whose install, start, stop and remove return the
literal `launchctl gui/<uid>` or `systemctl --user` argv, so `--dry-run` shows
the real commands; `darwin` and `linux` implementations now, `win32` in a
later work package) and applies it, stopping at the first failure with a
report of what was and was not done; a re-run plans only what is missing,
so it resumes without a journal. Prerequisites are checked before anything
is written (Node ≥ 22.18, pnpm through corepack, with `corepack enable
--install-directory ~/.local/bin` as the fix where Node's directory is not
writable, git, the port free, the user service manager as above, the
compose checks above, and, with the browser provider, `unzip` and on Linux
Firefox's libraries), each failure with a one-line fix for that OS. The
wizard asks as few questions as it can: pressing Enter through every prompt
gives a running app with no price source, and the closing screen then says
so first and names Travelpayouts as the no-cost source, that it needs a free
Travelpayouts account (register at `https://www.travelpayouts.com/`, then
copy the token from the Profile's API token section, with `https://support.travelpayouts.com/hc/en-us/articles/203956083` as help)
and `pnpm gmt setup --reconfigure travelpayouts`; on an interactive terminal,
before applying the plan, it asks once "Paste a token now? (Enter to finish
without one)", so a first run can end with a source. Each provider prompt
states in one line what it gives, from §1's configurations table
(Travelpayouts: cached and authorised, constraints not checked; SearchApi
`trial`: for a smoke test only, never run on a schedule, and when chosen it
always asks how many trial searches are already used (default the current
`SEARCHAPI_TRIAL_USED`, else 0) and writes `SEARCHAPI_TRIAL_USED`, a count no
database holds; `40usd`: the $40 a month plan, Google Flights results through
SearchApi); the email step asks for the SMTP settings with the password
hidden (offering the test email at the end of setup is WP18's, once its route
exists); the browser
provider is offered only where its flags are set, and when chosen it also asks "If a run is interrupted (for example the laptop sleeps), should the browser part finish when it resumes, even outside the scheduled hours? [no]" (yes writes `CAMOUFOX_BROWSER_WINDOW=any`, §8.2), after the §2 costs
summary, with the server sentence and a typed `yes` on a machine with no
display, and its steps run in the order costs, consent method, download,
consent: `CAMOUFOX_ENABLED` is written only after consent succeeds, so an
interrupted step leaves the provider off (`not-set-up`) with `pnpm gmt setup
--reconfigure browser` to resume. Re-running is idempotent: existing values
are kept unless the operator asks to change them, and a file that differs
from what the plan would write is reported, never overwritten. Secrets are
generated with `crypto.randomBytes` and written only to 0600 files; an
answers file holding a secret must be 0600 (secrets may instead come from
standard input or a named environment variable), and an invalid secret's
value never appears in an error. Setup never writes `ALLOW_FIXTURE_PROVIDER`
or a `.fixture.db` path. Setup ends by printing the URL, the user name,
where the password lives and `pnpm gmt password` (which prints it to the
terminal only, never to a log; if scrollback or a shared screen may have
kept it, `--reconfigure password` replaces it), offers to open the browser,
always names the next step (open the app, choose Definitions, add a search),
says that nothing runs on a schedule until a search is given one, says what
keeps the app running (macOS: while the user is logged in; Linux: after logout
only with linger), says how to reach the app from another device, labelled as
only for that (an SSH tunnel, `ssh -L 3000:127.0.0.1:3000`, or §3's Tailscale
and TLS paths; the native service speaks plain HTTP), and says that scheduled
searches run only while the machine is awake, with a missed firing caught up
once on wake, without the browser provider (§8.2). Vendor keys are optional
prompts with hidden input, and setup calls no vendor. Every command that stops
or restarts the app (`stop`, `restart`, `update`, every `--reconfigure` group
but `linger`, the imports, `--replace-database` and `--ignore-docker`) passes
one guard first: it reads `GET /api/executions/active` and refuses (75) while
a run is active, or while the app is up and the read fails, unless `--wait` or
`--force`, with `update`'s `--force` statement below. `smoke` spends: it takes
the route as `--from` and `--to` (the smoke route requires one; lowercase is
upper-cased), refuses with the no-price-source text when no provider is
configured, and before posting to `POST /api/tools/smoke` with the
credentials in `app.env` it prints what it will use per provider from `GET
/api/tools/smoke/plan`, the route's own worst case ("SearchApi: up to 4 calls
(calendar 1, itinerary 3; trial: N left)", "browser provider: 1 page, up to S
scrolls"), refuses before posting when the trial credits left are fewer than
that worst case, posts a dry run (ledgering nothing) and stops on its refusal,
states the credits tool runs have already used in the window (the response's
`searchApiCreditsLedgered`) with the running total, and asks for a typed `yes`
for that total (`--yes` in scripts, which once earlier tool runs used credits
also needs `--accept-total`: decision 20); setup, update, status and the CI
jobs never run it. `update`
refuses a checkout with local changes or not on `main`; runs `git fetch` and
checks that `git merge --ff-only` is possible while the app still runs;
refuses while a run is active, naming it and its estimated finish (`GET
/executions/active`), and also when that read fails while the app service
is active (no answer, a non-200, a timeout), unless `--wait` (it waits for
the run to end) or `--force` (it says before acting that the app stops
within 30 s, that a page or call in flight is abandoned, stays on the ledger
and has its cells requested again, and that the run resumes from its last
checkpoint after the restart when `AUTO_RESUME` is on, or otherwise waits
for a manual resume). `--dry-run` prints its plan without fetching. It records
its progress in `<state>/update.json`, so a re-run after a failed install,
build, start or health wait carries on from that step, and it says "already up
to date" only when the checkout matches `origin/main` and the app answers
healthy. Its plan, in order: record the current commit, stop the app and the
worker, back up into `backups/update` (keeping 5, the database named
explicitly, with a `.commit` file beside the backup naming the commit) and name
the file, `git merge --ff-only`, `pnpm install --frozen-lockfile`, `pnpm
build`, install a new Camoufox pin when the manifest changed and that
entry's flags are set (otherwise install nothing, keep the old bundle and
say the provider stays off on this `<os>-<arch>` until recordings land),
re-render the units, start, wait up to 240 s for health (the compose start
period: a stale-lock wait, backup, migrations and seeding), remove the
previous Camoufox bundle once healthy, and run `status`. A failure at any
step after the stop prints the recorded commit, the backup and the native
restore steps (with no backup from this update, as when no code changed, it
says so and prints no restore steps), plus the shorter path when the database was not migrated
(`git checkout <commit>`, `pnpm install --frozen-lockfile`, `pnpm build`,
`pnpm gmt start`), shell-quoted, and rolls nothing back itself; a failed backup
before the merge changes no code. **Restore (native):** `pnpm
gmt stop`; `git checkout <commit>`; `pnpm install --frozen-lockfile`; `pnpm
build`; `pnpm gmt restore <backup>` (it refuses a file that fails `PRAGMA
integrity_check` on its 0600 copy before anything moves, keeps the current
database whole, its `-wal` and `-shm` with it, as `<name>.before-restore-<time>`,
never over an earlier one, and puts the checked copy in place, through the same
placement code as the imports); `pnpm gmt start`; `pnpm gmt setup` re-verifies
the pinned Camoufox. An update's backup names its commit in the `.commit` file
beside it. A restored ledger lacks any call made after its backup, so check the
vendor's dashboard and raise `SEARCHAPI_TRIAL_USED` (trial) or lower
`SEARCHAPI_MONTHLY_CALL_CAP` (`40usd`) to match; restore says which, and what
the next start will resume and catch up (`AUTO_RESUME=false` leaves the
resumes to the operator).
The checkout is then on a detached commit: run `git switch main` before the
next `update` (`gmt status` reports a detached checkout). `uninstall` stops
and removes every service, timer and agent (with `daemon-reload` and
`reset-failed` on Linux), removes the macOS log files, keeps
`~/.config/get-me-there`, `~/.local/share/get-me-there` and
`~/.local/state/get-me-there`, prints them, and offers to disable linger if
setup enabled it (with `--purge` too, read from the setup record before it is
deleted; without a terminal it prints the line); `--purge` lists what it will delete, asks for the typed
word `purge`, never runs non-interactively, and deletes only those three
directories, refusing one that is a symlink, `$HOME`, a root or not named
`get-me-there`, and names anything it leaves (the worker's directory when
`XDG_STATE_HOME` moved the state). `status` calls `GET /api/status`, prints the checks as a
table, exits non-zero on any `fail`, adds what only the machine can see (a
compose `app` container beside the native one, a detached checkout, the
worker's refusal), and, when the app does not answer, falls back to local
facts: the service manager's state, the last log lines, the settings files'
presence and modes, and the worker's `start-refusal.json`.

**The `camoufox` worker** (§2, opt-in) is not part of the image or of
compose: it runs on the operator's machine (macOS or Linux; Windows in a
later work package), launching the Camoufox `gmt setup` installed itself (`camoufox-js`,
`playwright-core`; no camofox-browser server is needed or called). It is
started from a checkout with `pnpm --filter @gmt/camoufox-worker start` (from
source, like the api's `tool` script) or as the user service `gmt setup`
installs (a launchd agent on macOS, a systemd `--user` unit on Linux), which
restarts it on failure no faster than once a minute. Every worker command
loads its settings from one file, `<workerData>/worker.env`, where `<workerData>` is
`~/.local/state/get-me-there/camoufox` (mode 0700), checking that file's mode
(0600, the user's own) before loading it; nothing secret is ever typed on a
command line. It refuses to start, exiting 78, when the platform is neither
macOS nor Linux, when its `<os>-<arch>` flags are not set for the running build, when the bundle's build or the `camoufox-js` version is not the
pinned one, when the install-directory entries cannot be verified or
created, when its profile holds a Google account cookie, when the `SOCS`
capture (or the "not-shown" record) is missing, stale or future-dated, or when another worker holds the
data directory's lock. It listens on `127.0.0.1` port 8090 only; Docker
Desktop forwards `host.docker.internal` to it. On Linux it serves the native
app only: a container there cannot reach the host's loopback, so the Docker
path on Linux leaves the provider off. The worker persists its
cool-downs, its signed-in refusal and its last page time in the data
directory, so one pacer and one cool-down serve every app that calls it,
the container and `pnpm dev` alike. The app image is built without the
worker (the Docker build excludes `apps/camoufox-worker` from its context and
its install), and the `app` service changes only by the `CAMOUFOX_*`
environment lines. The app works unchanged with the worker absent: with
`CAMOUFOX_ENABLED=false` the provider is not built; with it true and the
worker down, the stage's preflight skips the provider's cells as
`provider_unavailable` with no ledger rows, and every other provider runs.

---

## 14. Logging
pino JSON to stdout; `executionId`, `definitionId`, `providerId` on engine
lines; `redact` paths `apiKey`, `token`, `authorization`, `url.query`,
`req.headers.authorization` and the URL query/userinfo stripping rule, both
as specified in §5.3; no secrets, no full URLs.

---

## 15. Deviations from the original prompt
| Prompt said | This spec does | Why |
|---|---|---|
| Research providers, pick one, integrate ≥1 | Two integrated; Amadeus/Duffel rejected | §2 |
| "Documented, authorised interfaces" | SearchApi scraping-derived, opt-in, labelled | Ian's decision 2026-10-14 |
| No brittle scraping that violates provider terms | The `camoufox` provider (§2) scrapes Google Flights itself in the operator's own Camoufox, launched by a host-side worker: opt-in, off by default, no proxies, a fixed low rate, a stop and cool-down on any page that is not a recognised results page, never solving a challenge, labelled `scraped-self` | Ian's decisions 2026-10-14 and 2026-10-18 (continuity if SearchApi goes); its costs are stated in §2 |
| "Cheapest available / bookable" | "Cheapest round trip found"; provenance and age on every price | No path guarantees bookability |
| Free to operate | £0 config is Travelpayouts-only; SearchApi means the $40 plan | Its free allowance is a one-off trial |
| A specific set of origins and destinations as the initial set | No airports in code at all; every definition names its own, with autocomplete and a free coverage check; the docs example is London → New York | A personal tool should not need a code change to search a different route, and the operator's own route is private |
| Preferred currency default GBP | Base currency fixed at GBP (integer pence) for this build; `POINT_OF_SALE` is configurable | Multi-currency money handling is out of scope |
| Multi-airport queries | Per pair | Exact attribution |
| Daily scheduled search | Weekly default, sized to the plan | Cost; `budgetFit` enforces |
| Absolute date range | Relative windows supported and default | A scheduled absolute window expires |
| Filter without rerunning searches | Client-side filtering over the ranked page; `/results` has no filter parameters | One path, no refetch |
| Postgres/SQLite, Prisma/Drizzle | SQLite + Drizzle | One operator |
| Saved searches entity | Definition with schedule | One concept fewer |
| Airlines/routes as search dimensions | Filters and constraints | No provider exposes them |
| "Flexibility around travel dates" | Dropped | Duplicates window + nights |
| Phase 4 multimodal | Two columns + optional operator onward-cost estimate, separate column | Non-goal |
| Spend caps per search and month | Calls and cost caps at execution (billed and free), provider month/lifetime, global month incl. subscription fee; 0 = no spend; pre-start checks | Units unspecified |
| Live prices for table and alerts | Calendar basis, labelled, with search links | The £0 config must be useful |
| Optional auth | Refused unauthenticated on non-loopback; CSRF/Host checks; security headers | The API spends money |
| Multi-channel notifications | `Notifier` with email and log only | Premature abstraction |
| One container | A native user service by default on a local machine (macOS, Linux), set up by `gmt`; one container for a VPS | Decision 71: an easier first run for anyone cloning the repository |
| A personal tool | One operator per install; setup written for anyone technical who clones the public repository | Decision 71; multi-user stays a non-goal |

---

## 16. Work packages

| WP | Scope | Owner | Depends on | First failing test |
|---|---|---|---|---|
| 0 | Scaffold, thresholds, CI; `core` types, ports, errors, config schema, `syntheticAllowed`, `api-contract`, label formatter; `db` skeleton | Fable | — | `syntheticAllowed` truth table |
| 1 | `core`: windows, space, validation, roll-up, coverage, selection | Sonnet | 0 | hand-computed cell counts for the default and the enumerated tiny space |
| 2 | `core`: normalisation helpers, hashing, constraints, classes, rank/filter/band, money, alerts | Sonnet | 0 | `VS 938` ≡ `VS938` hash |
| 3 | `db`: schema, migrations, repositories, `BudgetGuard`, cache, lock, seed, maintenance | Opus | 0 | 1,000 × 3200 µGBP trips a 300p cap |
| 4 | `providers`: http-kit, recorder, scrubbing, egress; fixture provider as an HTTP adapter | Opus | 0 | reserve happens before fetch on every attempt |
| **4b** | `record:fixtures` (records the public example route, LHR/LGW → JFK/EWR, through the real recorder, incl. a 429 if one can be induced; ~12 of the 91 remaining trial credits) and the minimal **wiring helper** (config parse + port construction) that WP8's bootstraps reuse | Fable | 3, 4 | recorded fixture carries a verifiable content hash |
| 5 | SearchApi adapter | Opus | 1, 2, 4, 4b | tiles partition the band |
| 6 | Travelpayouts adapter | Sonnet | 1, 2, 4, 4b | empty envelope → `no_data` |
| 7 | `engine` with layer-A tests (fixture provider through http-kit) | Opus | 1, 2, 3, 4 | resume after k of n tiles issues n−k |
| 8 | `api` (app and tool bootstraps on the WP4b helper, `/tools/*` routes) | Sonnet | 4b, 7 | production boot lacks `fixture` |
| 9 | `web` shell, Definitions, Results, Coverage | Sonnet | 8 | price without provenance fails to render |
| 10 | `web` Calendar, Duration, History | Sonnet | 9 | five-way day counts |
| 11 | alerts, email, Alerts UI | Sonnet | 7, 8, 10 | 50 firings → one digest |
| 12 | Docker, compose, env, backup, docs | Sonnet | 8, 9 | Dockerfile sets production + container flag |
| 13 | `smoke:live`, layer-B engine tests (real adapters replaying recorded fixtures), the `app_lock` "tool bootstrap starts no execution" test, integration review, final pass | Fable | all | live smoke exits 0 with provenance |
| 14 | `camoufox` provider: recordings, core widening, host-side worker (`apps/camoufox-worker`, embedding `camoufox-js`), adapter, engine rows, docs | Opus | 13 | a recognised CAPTCHA page stops the worker and starts the cool-down |
| 15 | `camoufox` `grid` mode: the `--grid` recording, the cell grammar, the scroll planner, `return_date_source` and `scroll_count` (migration 0006), the `grid-path` tile, labels, estimate, docs | Opus | 14 | a cell whose return is not in the footer's seven dates is unparsed, never stored |
| 16a | Local-mode foundations: migration 0007 (`scheduled_for`, `is_catch_up`, the firing unique index) and the catch-up (boot and the minute job), `GET /executions/active`, the moved-database marker in the app and tool bootstraps, `CAMOUFOX_BUILDS` and `FLAGS` with the pure start checks, `SHARED_WORKER_SETTINGS` with effective values and the worker's `sharedSettings`, `sharedSettingDiffs`, the worker status fields WP17 fills, the billing-month window in `core`, `startRefusalSchema` with `START_REFUSAL_TEXT`, `workerDataDir` and `readWorkerStatus` in `core` and `providers`, `GET /tools/smoke/plan`, the History label, the two-apps docs line, the engine's Stryker config | Opus | 15 | with the coverage read stubbed to "uncovered", a late live tick and the minute job reaching the insert with the same `scheduled_for` give one execution, and the loser seeds no cells, sends no notice and calls no provider |
| 16b | Local setup: `apps/cli` (`gmt`) and its `Platform` layer (launchd, systemd `--user`), the native app service and backup job, `--import-docker`, `--import-db` and `--ignore-docker`, `start`/`stop`/`logs`/`backup`/`restore`/`password`/`smoke`/`update`/`uninstall`, the image's `apps/cli` manifest, the CI matrix, `install-e2e` and the workflow guard, `setup.md`'s quick start | Opus | 16a | a second `setup` over an `app.env` that differs from the plan reports the difference and writes nothing |
| 17 | Camoufox install and consent: the verified install from `CAMOUFOX_BUILDS` with the CLI-owned layout, the worker's install directory and Linux fonts, flags per `<os>-<arch>` bound to their build, the `consent` command with export, import and check, the worker's own monthly caps, key rotation under `--reconfigure browser`, the worker service and its refusal file, the provenance notes' wording, the recording sessions for the other three entries, the `camoufox-install` CI job | Opus | 16a, 16b | a download whose SHA-256 differs from the manifest is refused and nothing is moved into place |
| 18 | Status: `statusResponseSchema`, `GET /api/status` with every check (the worker's through http-kit), `POST /alerts/test-email`, the consent email on the maintenance tick, `gmt status`, the Status view and the status bar link, redaction tests | Sonnet | 16a, 16b | a status response holding the basic-auth password, the worker key or a `SOCS` value fails the redaction test |

---

## 17. Changelog

### Revision 39: the status report after its branch review (2026-10-25)

From WP18's branch review (58 findings, every one addressed), §8.3 and §10 state the status report as built: the
consent notice's subject comes from the check's cause (a check that cannot be made sends nothing), it is claimed
only after a send and is also sent by the minute job; the fix is the capture script that exists today; a worker
that will refuse pages is `fail` by the preflight's own rule; the provider card's auth or quota class is the
adapters' (ledger `error_kind`, migration 0008) and a rejected 2xx is not a success; the email card reflects the
newest send of any kind and the test email has its own limit; cards carry a `label`, disabled searches are
`off`/`disabled`, and nothing a state rests on is truncated; the container's version is a build argument.

### Revision 38: the browser provider's pauses may be 0 (operator ruling, 2026-10-25)

The operator ruled that the browser provider's two pauses may be set to 0, meaning no pause at all.
`CAMOUFOX_MIN_SPACING_SECONDS` takes 0 to 600 (default still 30) and `CAMOUFOX_GRID_SCROLL_SPACING_SECONDS`
takes 0 to 30 (default still 5); the page spacing joins the shared settings (§12), so a worker left at 30 beside an app at 0 skips the provider. §2's limits paragraph, the grid paragraph and §12's block state the new ranges;
at page spacing 0 the app's limiter has no rate limit (the page caps alone bound a run), the worker's pacer lets a
claim pass at once (still one page at a time, still recording the last page time), and the estimate's 40 s a page
is unchanged. The per-run page cap, the monthly page and scroll caps, the cool-downs and every stop the classifier
triggers are unchanged. No other design rule changes.

### Revision 37: the local setup as built, after its branch review (2026-10-24)

From WP16b's branch review (104 findings, every one addressed) and its rulings U1 to U13, §13 states the setup
as built: one active-run guard for every command that stops or restarts the app; the SearchApi trial's used
count lives in the settings and is never in a database, so an import never supplies it and the wizard always
asks it on the trial; imports apply in phases, each a real plan, with recovery text per failure and the first
start's resumes stated; `--import-db` reads the source's lock through `scripts/lock-state.mjs`; restore keeps
the current database whole under a timestamped name through the imports' placement code, with plan-specific
dashboard advice; `update --dry-run`, its progress record and its `.commit` file; `smoke --from --to` with its
dry run first and the running total confirmed (`searchApiCreditsLedgered` on the tool route's response, §10);
a `linger` reconfigure group; the closing screen's next step, schedule and keep-running lines; uninstall's linger
offer under `--purge`; and the test email's offer moved to WP18. No design rule outside §10 and §13 changes.

### Revision 36: local setup, consent capture and status (2026-10-19)

From the operator's local ease-of-use rulings and three reviews of the design
(137 findings, then 65 more and 11 partly resolved, then 30 more, every one
addressed):
the app runs natively as a user service by default on macOS and Linux, set
up by a new `gmt` command (`apps/cli`), and Docker stays the VPS path. §1:
one operator per install. §2: the worker runs on macOS or Linux, always
headless, from an install the CLI makes and owns from `CAMOUFOX_BUILDS` (one
pin per `<os>-<arch>`, the assets and digests of release
`v152.0.4-beta.28`), with Linux fonts made absolute, verification flags per
`<os>-<arch>` bound to their build, and its own monthly page and scroll caps
across every caller over the ledger's billing month; `gmt consent` captures the rejection in a visible
throwaway window where a person clicks, observed read-only under the pacer
and cool-downs, built only once a recording proves a rejection mark computed
from the cookie's value, with export, import, a rate-limited server-side
check and a voided record; the costs shown before every opt-in; provenance
notes that hold on a server. §7: `scheduled_for`, `is_catch_up` and the
firing unique index; the skip reason `scheduled_only`. §8.2: a missed
firing (a late live tick included) is caught up once, unless the next is
under half its own gap away, a catch-up never loads browser pages, and any
other run loads them, by default (`CAMOUFOX_BROWSER_WINDOW=scheduled`), only
inside its window (its firing to 1.5 × its estimated duration later; a
resume or a run outside it leaves the browser cells `scheduled_only` for the
next scheduled run), or, with `any`, whenever it resumes; `gmt setup
--reconfigure browser` asks which in plain words; the window's end is
stored at start and reset only by a live-tick resume, and it is checked only
at a run's first browser page, at a resume, or after the machine has slept
(never while a run keeps going, so runs sharing the worker keep their tails), and every skip reason is stored with its row.
§8.3:
the consent email on the maintenance tick. §9: the planners' tests, the real
data-loss tests, the CI matrix with Windows' listed known failures,
`install-e2e`, the `camoufox-install` job and the structural workflow
guard. §10: `GET /status`, `GET /executions/active`, `GET
/tools/smoke/plan`, `POST /alerts/test-email`. §11: the Status view and the status bar's links. §12:
where settings live, the round-trip check, the shared settings and key
rotation. §13: native mode, the `gmt` commands, the Docker and checkout
imports, update, native restore and uninstall. §15: two rows. §16: work
packages 16a, 16b, 17 and 18. Plan decisions 71–83. Windows setup is a later
work package. WP16a's branch review (2026-10-24, rulings R1–R44) is folded
into the sections it touches: a late live tick keeps the tick order; the
engine's shutdown stops runs taking new work, then waits (bounded by the
notice's SMTP timeouts) for running scheduler callbacks; a catch-up in flight
at the next firing covers it, one paused there (`paused_at`) is superseded by
that firing's row whatever it is, and its automatic resumes yield to the
firing; the browser-only test is cabin-aware; the window anchors at the
later of the firing and the start, is re-anchored inside the resume's claim,
is checked when the limiter admits a page (a refused page hands back its
limiter tokens), and has its own notice kind, which says the other providers
carry on only when one still searches; a left cell names the next scheduled
run only when the definition has one that still uses the browser provider,
and only for the latest run; View D's header names a skipped firing;
`GET /executions/active` reports a single-cell verification too; the
shared settings have one rule set; `app_meta` holds the app-instance id; the
moved marker has one format.

### Revision 30: point of sale on full price displays (2026-10-18)

§11: the provenance line lists point of sale ("UK market", "market not
stated", or the code and "market", from `core`'s labels) on the full price
displays and the alert email's provenance line, and keeps it off the compact
calendar face and the phone face.

### Revision 31: SearchApi cheapest set (2026-10-18)

§5.2, §5.4: SearchApi `google_flights` sends `show_cheapest_flights=true`
on every step (docs read 2026-10-18: no other value, no extra cost, no
response change); the allowlist gains a later dated file, and replay
reaches recordings made before it through the dated allowlist history.

### Revision 32: the camoufox provider (2026-10-18)

§2 "Continuity fallback" rewritten as a built, opt-in `camoufox` provider:
a host-side worker (macOS only) that launches the operator's Camoufox
itself through `camoufox-js`'s own install layout in its own signed-out
profile, service workers blocked, every navigation and redirect guarded
(never the camofox-browser server); recordings first, starting with the
`SOCS` capture; result names read through locators; a named account-cookie
set across both Google hosts; `SOCS` compared by value; discovery only, `list` mode built and `grid` mode designed; the
search form and settle checks; `scraped-self` with `maxAgeHours` 0; no
proxies; consent rejected through a pre-set `SOCS` capture and any consent
page a stop; cool-downs by cause (48 h for challenge, sign-in and consent pages, 1 h for
an unrecognised page); a preflight status read; `no-page` ledger rows outside
the page caps; spacing start to start; a page cap frozen per execution;
coverage and costs stated. With the §1, §3,
§5.1–§5.3, §8.1, §11, §12, §13, §15 and §16 rules it needs (plan decisions 68
and 69).


### Revision 33: neutral wording for the camoufox provider (2026-10-18)

§2, §8.1, §12, §15 and §17 (operator ruling): Camoufox is described as a
Firefox-based browser the operator has installed; the stop rule reads "the
worker stops and cools down whenever a page is not a recognised results
page: a challenge or verification page, a sign-in page, a consent page, or
anything unrecognised"; consent reads "the operator's saved cookie choice
(Reject all) is applied before every page; a consent page stops it"; the
cost that stated the terms position reads "Read the provider's terms before
enabling it; the operator is responsible for how it is used"; the
provenance note drops the same sentence. No rule, test or safety check
changes.

### Revision 35: the camoufox grid mode's fix round 1 (2026-10-18)

§2's `grid` paragraph, from the branch review of work package 15 and
CodeRabbit's pass on its pull request: the lattice anchored at today once a
window has started; the horizon bounding returns as well as departures, with
the probe opened at the least pair past it; a no-flights page `no_data`
for every cell of the probe page and, inside the horizon, for its query cell
only, the others resumable (`no-flights-unseen`); a 0-night diagonal block opened a day later and scrolled up to; block
moves that keep every view holding round trips; the page's scroll allowance
from what the guard says the caps leave; the preflight's check of the
worker's scroll cap and spacing; the off-plan causes named only from what is
known; a pair read twice failing the tile. §2's ledger paragraph and §7's
`scroll_count`: an `unknown` call keeps its planned scrolls. §2's coverage
paragraph states the estimate's own figures (100 pages and 588 scrolls a run
at the defaults, with each pair's joined pages first and the pairs taken in
turn, 3 runs a full pass), the scroll time as the longer of the
measured time and the spacing, the stuck-run note and the month's scroll
warning. A stored grid-cell price is labelled assumed from its own row.

### Revision 34: the camoufox grid mode designed (2026-10-18)

§2's `grid` paragraph rewritten from the two graph explorations of
2026-10-18 (the Price graph's chart has no readable bars; its Dates tab is a
readable 7 × 7 grid of named buttons): the Price graph and Dates clicks, the
dated cell grammar with its year and rollover rule and its header, footer
and order checks, the block lattice for the stay range, the scroll path cut
into pages under a scroll cap and a fixed scroll spacing, two-stable-polls
settles classified on every poll, a stop discarding the whole page, the
"Google Flights date grid via Camoufox" label and note, the vendor's
"cheapest price" mark kept as a vendor flag, and the coverage arithmetic.
§5.2 gains the `grid-path` tile; §7 gains `calendar_prices.return_date_source`
and `vendor_price_mark` and `provider_requests.scroll_count` (migration
0006) and lists `page_class`; §2's ledger paragraph counts scrolls on the
page row, never as pages; §16 adds work package 15. §12's block and
`.env.example` gain `CAMOUFOX_MODE` (list or grid),
`CAMOUFOX_GRID_SCROLL_SPACING_SECONDS` (default 5, at least 5),
`CAMOUFOX_GRID_SCROLL_CAP` (default 30, at most 60),
`CAMOUFOX_EXECUTION_SCROLL_CAP` (default 600) and
`CAMOUFOX_MONTHLY_SCROLL_CAP` (default 6,000). After the round-1 review (0 Critical, 9 High, 19 Medium, 11 Low;
rulings folded into plan decision 70): a dialog view `dates-grid` for the
classifier, cells found by position, a grammar-drift stop, the assumed 24 h
age, whole pounds stated, SearchApi's `is_lowest_price` stored as the
vendor's mark, the viewport pinned at 1280 × 900, the scroll step measured
and passed to the planner, a post-scroll view counted only once it changes,
a budget per move, off-plan views at the sale window's edges, the scroll
caps and 5 s spacing, and a retry factor of 1.0 for camoufox in §8.1. After the `--grid` recordings
of 2026-10-18: a one-day scroll step measured on both axes, cells read by
their names with the lines as a set check (the page rotates its elements
after a scroll), the "low price" mark (`vendor_price_mark` an enum),
thousands separators, views of fewer than 49 cells, the year rule from the
query, the no-flights page past the sale window as `no_data` and a planning
horizon, the measured times, and a planner that chooses between a new page
and scrolls within both caps. No built behaviour changes (plan
decision 70).

### Revision 29: CodeRabbit batch 3 (2026-10-17)

Folded in from CodeRabbit's third batch (scripts, live docs, and the brief
findings checked against shipped code). §3: the provenance record's point
of sale is named as a type, so the declaration is one code span. §5.4: a
malformed SearchApi option is dropped, counted and makes the result
partial. §5.3 Egress: http-kit refuses a query parameter named like a credential, whatever
its value (`departure_token` and `booking_token` excepted). §7:
`route_price_history` stores each point's point of sale (migration 0004;
older rows read 'unknown') and every point's FX status reads "not
converted". §8.2: the £0 Travelpayouts cadence row is ~148 calls a month
(every weekly firing refetches), and the daily SearchApi headroom is
~2,330 a month, both from the budget-fit formula. §11: compact price faces
are `PriceCell` variants that validate the complete provenance; point of
sale is validated, not a face item. §12: the hourly email ceiling counts
sent and in-flight emails only; a failed send gives its slot back.

### Revision 28: final whole-branch review (2026-10-17)

Folded in from the final whole-branch review (plan decision 67).
§3, §11: provenance stays visible without hover on every face too small
for the row form (desktop calendar day, phone face, the 375px Results row):
provider mark, short age line ("5d old"), "not checked" on calendar prices;
the title may carry the long form, never the only form (this overrules plan
decision 46). §3, §6.6, §11: the "searched" umbrella appears only in View
D; day faces and the status bar show buckets. §7, §10, §11:
`route_price_history` is keyed by the searched trip (dates and cabin, NULL
trip on migrated rows, GBP only; migration 0003) and History names the
trip. §7: `search_definitions.confirmed_calls`; the WAL journal mode is
read back and enforced. §10: the calendar route takes `?destination=` and
returns no per-destination breakdown (plan decisions 53, 58); provider
usage carries only the window each plan uses, and `/providers` gains
`capNote`; View D carries the on-demand children. §8.1: departed `error`
outcomes become `skipped:departed` too; a child's call cap never exceeds
the headroom (no child for a 0-call run cap); "+C on demand" counts by K's
predicate inside the current space; discovery overruns are judged on
tiles. §8.2: a firing refused for no runnable provider is not "missed".
§5.2: SearchApi quota exhaustion (402, or 403/429 naming credits or quota);
`stops` sent from `maxStops`; unreadable Travelpayouts itinerary tokens
counted. §5.4: "cheapest-first" among the options the vendor returns. §2:
the calendar's 24-hour bound is marked an assumption; the tiling figure is
9 × 20 (180 combinations, 21 rectangles a pair). §4, §13: pnpm 12
`allowBuilds`; no `@hono/zod-validator`. §6.9: a row's own vendor link
first. §9: the mutation gate's sandbox and timeout rule, and the local
recorded-suite gate. §11: the status bar's binding window; thin-coverage
line; nav wraps on a phone. §12: the `.env` block says what the container
fixes; the zero-cap warning needs a per-call cost; spend cap below fees
warns; `SEARCHAPI_TRIAL_USED` refused on a monthly plan; the hourly rate
clamped to the vendor's 20% rule.

### Revision 27: web wording and defaults (2026-10-17)

§11: the calendar-gap banner names the reference verified price (plan
decision 58). §10: a new definition defaults to disabled (no unattended
runs until the operator enables it); definition defaults live once in core.

### Revision 26: deployment details (2026-10-17)

§1, §8.2: cost figures point to the generated `docs/scheduling.md` instead
of hand-written numbers. §12: `ALERT_EMAIL_MAX_PER_HOUR`. §13: fixture
recording runs from a development checkout, never inside the container
(recordings are local-only, decision 61).

### Revision 25: alert delivery (2026-10-17)

§6.8, §7, §8.1: at most one digest per rule per stop of an execution (a
budget pause and the later completion may each send one), never a repeated
firing; alert events are `queued`, `notified` or `suppressed`, written
queued before sending; outgoing email has an hourly ceiling (plan decisions
55, 56).

### Revision 24: stride and resume details (2026-10-16)

§6.7: the stride fallback applies when no discovery provider sells the
definition's cabin. §7, §8.1: a resume never re-fetches a departed cell; an
execution-scope budget pause resumes only manually (plan decision 50).

### Revision 23: unknown vendor age (2026-10-16)

§3: a price whose vendor cache age is unknown is aged by `fetchedAt` alone,
labelled "vendor's cache age unknown", and not marked stale for that reason
(plan decision 44).

### Revision 22: unconfirmed and truncated prices (2026-10-16)

§3, §6.6, §7: a priced outcome's reason may carry `price-unconfirmed`; a
cell's verification price counts only prices the final step confirmed, and
shows "price not confirmed" when it has none. §8.1: a price from a
truncated tile is never reused. (Plan decisions 45 and 48.)

### Revision 21: engine reasons and verdicts (2026-10-16)

§3, §7, §8.1: `no-priced-options` joins the closed error-reason list and the
non-retryable set; a budget stop refuses new reservations only (decision
25). §6.2: an offer whose price the final step did not confirm is classed
`unverified` ("price not confirmed by the final step"); calendar prices use
core's `priceInGbp`.

### Revision 20: provider table age cell (2026-10-15)

§2: the SearchApi itinerary row's age cell reads `'unknown'`, matching rev 15.

### Revision 19: Travelpayouts row age (2026-10-15)

§2, §3: a Travelpayouts row's age comes from the `search_date` in its link
(day resolution, read as 00:00 UTC of that day); the vendor's 48 h
declaration is only the fallback when a link lacks it. The live recordings
showed rows four to seven days old.

### Revision 18: child caps and budget stops (2026-10-15)

§6.7: a child execution's call cap derives from its cell's estimate and the
parent's headroom, with `CHILD_MAX_CALLS` as the floor, and a child never
pauses. §5.3: a reservation that passed every cap is honoured and its result
written; a budget stop refuses only new reservations (plan decision 25).

### Revision 17: no metro queries (2026-10-15)

§2, §5.1, §5.2, §8.2: the live recordings showed that a Travelpayouts metro
query returns one cheapest row per date pair across the whole metro, hiding
the definition's own airports' fares; Travelpayouts is queried per airport
pair only, `DiscoveryQuery.definitionOrigins` is withdrawn, and the worked
example is 28 upstream free calls per scan.

### Revision 16: provider-port fields (2026-10-15)

§5.1: `DiscoveryQuery.definitionOrigins?`, `cellIssues?` and `truncated?` on the
tile result, and `RawOffer.verified`, as the WP5/WP6 brief reviews settled
(plan decisions 27–31).

### Revision 15: SearchApi tiling and itinerary age (2026-10-15)

§5.2 and §8.2: SearchApi calendar rectangles use the largest outbound block
b with b × (b + maxNights − minNights) ≤ 200 cells (9 days for the 10–21-night
band: ~21 tiles per pair, ~84 discovery calls for the worked example instead of
~92). §3: SearchApi itinerary results carry `maxAgeHours: 'unknown'`, since the
vendor may serve a cached answer of undocumented age (spike fact 4).

### Revision 14: metro query rule (2026-10-15)

§5.2: the Travelpayouts query uses the metro code only when two or more of
the definition's origins map to that metro, matching the §2 provider table;
a lone airport is queried by its own code.

### Revision 13: placeholder format (2026-10-15)

§5.3: recorder placeholders are `<key:n@session>`, matching the plan's
decision 17 and the http-kit implementation; the earlier `<departure_token:0>`
example lacked the session scope.

### Revision 12: second-pass clarifications (2026-10-14)

§5.4: in a chained itinerary search only `upstream`, `network` and `parse`
errors count as a failed expansion; account and rate refusals propagate.

### Revision 11: rules settled by the wave-1 brief reviews (2026-10-14)

Twenty-six reviewer runs over the WP1–WP4 briefs. Folded in: the 429
quota rule drops its ledger arm and gains a header-less fallback (§5.2); the
http-kit seam is stated and in-flight joiners are ledgered (§5.3); dedup
chooses by class before price and stale rows are never demoted (§6.5);
cabin-not-offered precedence, roll-up reasons and the reused-copy
replacement rule (§6.6); the `maxCells` hard bound (§6.7); the minimum drop
step inside the cooldown and suppressed firings recorded (§6.8); the
`providers` table removed, alert rules soft-deleted, the app-lock refusal of
a live second app (§7); route calendar history as one point per fetch
(§10); search links absent on synthetic rows (§11).

### Revision 10: contract corrections from the brief-drafting pass (2026-10-14)

Fourteen work briefs were drafted against revision 9 and the implementation
plan; each reported where the spec was silent or contradicted itself. Folded
in: `tileIndex` on `reserve`/`recordCacheHit`, a `month` tile kind,
`pointOfSale` on provider results, optional `routeHistory` (§5.1); point of
sale is any ISO alpha-2 code (§3); the vendor message lives in `last_error`,
never `reason` (§3, §5.2); `cabin-not-offered` is an engine rule (§3, §5.2,
§8.1); Travelpayouts queries per pair by metro code with cache dedup (§5.2);
SearchApi rectangles use the tight return span (§2, §5.2); FX goes through
http-kit, never ledgered, at `api.frankfurter.dev` (§5.3, §5.6); validated
links keep their query in API bodies and emails (§5.3); the supersede rule is
a safety net (§6.6); schema additions and the 336 h cooldown default (§7);
manual resume refreshes the snapshot's budget; deleted definitions are never
resumed; boot makes no network call (§8.1); the cadence table is for the
worked example's 4 pairs and §1's numbers now match it; the API lives under
`/api` with `GET /airports` and `POST /definitions/estimate` (§10); vocabulary
for the calendar source and the basis label, six buckets in View D, History
x-axis for the route series (§11); `APP_BASE_URL` (§12); no curl in the
image, no `env_file`, Mailpit for host dev only (§13); React 19 and the gated
in-process fixture seam (§4); WP dependencies (§16). A second pass added
the §6.1 lookup signature, the three silent §5.4 cases, four §7 columns and
the `best_observation_id` semantics, the child budget rule (§8.1), the
§8.3 subject wording and the backup routine's home (§13).

### Revision 9: decisions taken at approval (2026-10-14)

Ian approved revision 8 and settled three open items, folded in without any
change to a design rule: self-scraping via Camoufox is a named Phase 4
continuity fallback in §2 (not built; types not widened; §1 non-goals and
§15 updated); the SearchApi dashboard readings close spike facts 4 and 7
(cached repeats and error responses are not billed; the free allowance is a
one-off credit balance, so `trial` stays a lifetime window and
`SEARCHAPI_CACHE_TTL_HOURS` is no longer provisional); the $40 plan is the
plan Ian is subscribing to (§1, §2 fact 7); WP4b no longer carries the
dashboard readings.

### Revision 8: operator's route removed from the repository (2026-10-14)

The worked example is London → New York throughout; the spike record and
fixtures and the four review summaries moved out of the repository; §2
spike results reworded without route names; WP4b records the example route.

### Revision 7: route-agnostic (2026-10-14, after the operator's correction)

No airport, city or country in application code: Travelpayouts tiling
uses the definition's origins (or their shared metro code from the
airports table), the "gateway mode" and the default definition with
airports are gone, the Definitions form starts empty with a free coverage
check and an importable docs example, the per-destination note is operator
text, the airport seed sanity check is generic, and `POINT_OF_SALE` is
configuration. Cadence rows are formulas with the worked example beside
them. §15 gains two rows.

### Revision 6 after the provider spike (2026-10-14)

Spike facts 1–8 resolved in §2. £0 configuration shown to be route-dependent
(thin routes can have no cached rows at all);
Travelpayouts tiling is `month` tiles via `LON` (21 per scan), `maxAgeHours`
48, `pointOfSale` unknown, economy only; SearchApi calendar is per airport
with a hard 200-combination 400, 9–29 s latency; `bookingLinks` forced on
after the parity assertion failed; unpriced options skipped;
`route_price_history` table added; cadence rows and §1 recomputed; WP4b
narrowed to re-recording and the wiring helper.

### Revision 5 against review 4 (101 findings)

1. Fold regressions repaired: §5.3 secret-sink list and §6.1 generation contract restored in full; §14 names the redact paths [arch-r4-001, sec4-001, devops4-005, strat-r4-001, arch-r4-010, po-308].
2. Subscription cost model: marginal cost 0 on subscription plans, fixed fee counted once, call cap is the hard stop; §1 headroom, §8.2 row and presets recomputed [cost-401, po-302, pft-r4-002, pie4-006, prov4-011, cost-405, cost-406].
3. WP4b owns a wiring helper; smoke, lock test and layer-B engine tests move to WP13; WP7 tests run the fixture provider through http-kit; WP8 depends on 4b; no injectable fetch [arch-r4-002, arch-r4-003, test-002, arch-r4-004, arch-r4-005, arch-r4-006].
4. Pre-start per provider and stage; global-month breach affects billed providers only [cost-402].
5. `confirmed_cost_pence` only from explicit confirmation; PUT returns `needsConfirmation` [cost-403].
6. Per-segment cabins on the observation; `max_age_hours` on observations; FX CHECK both directions; cabin/POS/kind on outcomes; cabin filter on every read and in calendar alert identity [dm-301, dm-302, dm-305, dm-303, dm-304, prov4-001, prov4-003, prov4-004, arch-r4-009].
7. `app_lock` symmetric with SIGTERM release and takeover; `/tools/*` routes; tool bootstrap refuses test [devops4-001, devops4-007, prov4-009].
8. £0 sparseness stated; first-run coverage line; six buckets; reused and on-demand counted; "searched" defined [pft-r4-001, po-301, strat-r4-007, prov4-006, prov4-007, prov4-008, ui-002].
9. Calendar drop window on `fetchedAt`; cooldown 336; "new" never a drop firing [po-303, po-306, pft-r4-006].
10. Parity-failure rule forces `bookingLinks`; every step-2 return option persisted; Travelpayouts market gate; `point_of_sale` `unknown`; SearchApi calendar currency and `maxAgeHours` 24; other 4xx mapped; paginated tiles ledger `tile_index`; month-matrix removed [pie4-001, pie4-002, pie4-003, pie4-004, pie4-005, pie4-007, pie4-008, prov4-005].
11. Provider-month row split; resume compare-and-set; `departed` scoped; supersede for any stale paused run; retry-errors on completed; ceiling unset rule; `skipped_window` and `skipped_missed`; deterministic normalisation failures excluded from auto-resume; `alwaysInclude` membership at save, dropped with a note at start [strat-r4-002, strat-r4-003, strat-r4-004, strat-r4-005, strat-r4-006, strat-r4-008, strat-r4-009, strat-r4-010, strat-r4-011, strat-r4-012, strat-r4-013, strat-r4-014, arch-r4-008].
12. `/results` returns all classes ranked by class then price; dedup per itinerary; sort keys and filters listed; cells route; health exempt from Host; `fx` through http-kit; `parseCron` in engine [ui-001, dm-306, po-307, prov4-002, prov4-010, devops4-002, arch-r4-007, arch-r4-011].
13. Security: `TRUST_PROXY` for the auth rate limit, `.gitignore` and CI scan, `/data` ownership in the Dockerfile, link allowlist matching [sec4-002, sec4-003, sec4-004, sec4-005, devops4-003].
14. Backup failure refuses migrations; lifetime plans keep ledger rows; billing day 1–28; `discoveryRefreshHours` default 168; `STALE_AFTER_HOURS` 192; overrun vs pre-factor plan; missed-firing notification [devops4-004, dm-308, cost-407, cost-408, po-304, po-305, cost-404, devops4-008, pft-r4-004].
15. UI: headline with destination and dates on two lines; compact age labels; quintile scale per basis; verify hidden on £0; label consistency [pft-r4-003, pft-r4-005, ui-003, ui-004, po-309, prov4-013, dm-307, prov4-012].
16. Tests: hand-computed counts; db-level cap test; bootstrap spawn assertions; recorded-file content hash; Stryker scope; branch floors [test-001, test-003, test-004, test-005, test-006, test-007].

### Revision 4 against review 3 (126 findings)

1. `fetchedAt` on tile and result from http-kit; `maxAgeHours` required per
   capability with values in §2; label format in `core`; unknown-age
   ordering [arch-r3-001, prov3-007, ui-005, prov3-015].
2. Synthetic gate: tmp branch replaced by `.test.db`, realpath in bootstrap,
   `IN_CONTAINER`, compose env allowlist, provider⇔kind check, real
   bootstrap spawn test, http-kit `fetch` seam gated [arch-r3-002, sec3-005,
   prov3-006, prov3-019, test-r3-001, test-r3-002, arch-r3-006].
3. WP4b spike/record/tool bootstrap [arch-r3-003, arch-r3-007].
4. Execution-calls predicates for billed vs free; presets with full table;
   global cap includes fixed fee; boot warning on 0 cap; trial default
   definition; 100usd removed; `SEARCHAPI_TRIAL_USED` [cost-301, cost-303,
   cost-308, cost-310, po-204, pft-r3-006].
5. Adapter retries removed; per-request timeout; retry bounds; parity metric
   redefined; retry factor on discovery [cost-305, cost-304, cost-306,
   pie3-007, strat-r3-008].
6. Child observations included in results/calendar-gap/counts; child cell
   columns and index; no parent required [dm-201, po-202, strat-r3-004,
   prov3-013, dm-208, strat-r3-015].
7. One calendar price per (provider, cell); reuse predicate with cabin/POS/
   kind; reused rows excluded from history and alerts; supersede rule;
   transactions for selection+seeding and reuse [dm-202, dm-203, dm-204,
   prov3-001, strat-r3-013, dm-210, prov3-012, strat-r3-007].
8. Search link on every row; default basis calendar; inapplicable
   constraints note; effective age as a number; calendar stale threshold
   derived [pft-r3-001, pft-r3-002, po-206, pft-r3-003, pft-r3-004].
9. Five-way coverage breakdown; "itinerary-searched"; headline carries
   basis/class/provenance [po-201, prov3-008, ui-002, po-205, prov3-004,
   prov3-016, ui-003].
10. Alert digests, cooldown default, sparse-cache drop rule [po-203,
    pft-r3-005].
11. Currency from response; `currency-unsupported`; ECB coverage; `gl=gb`;
    allowlist with values; quota discrimination; placeholder tokens in
    fixtures; step-3 parity definition [prov3-002, pie3-008, pie3-002,
    pie3-006, pie3-005, pie3-004].
12. Empty-is-per-capability [prov3-003, pie3-001, strat-r3-001].
13. Per-segment cabin and unverified cabin verdict [prov3-005].
14. One-shot resume jobs; departed cells on resume; `estimateRemaining`;
    paused run superseded; manual resume re-enables providers; pending
    sweep; interrupted auto-resume; counter semantics [strat-r3-002,
    strat-r3-003, cost-307, strat-r3-009, strat-r3-006, strat-r3-012,
    devops-001, strat-r3-005].
15. Vendor URL validation in core; render rules; 375 px badge; security
    headers; TLS guidance, auth rate limit, password length; `SMTP_TLS`;
    fail-closed prebuilt; IATA checks in validation [sec3-001, ui-001,
    sec3-002, sec3-003, sec3-004, sec3-006, sec3-007, devops-007].
16. Ports trimmed; cron single validator; `ProviderError.reason`; client-side
    filtering only; `@date-fns/tz`; grouped capabilities with typed
    `TileRequest`; dead fields dropped [arch-r3-004, arch-r3-005, arch-r3-008,
    arch-r3-009, ui-006, arch-r3-010, arch-r3-011, arch-r3-012].
17. Cadence table recomputed; "what $40 buys" [cost-302, po-207,
    strat-r3-016, pie3-003, pft-r3-007].
18. Schema: `self_transfer` on observation; `best_observation_id`;
    `last_verified_at` dropped; `unknown-airport-tz`; `app_lock` symmetric
    with heartbeat; retention job; backup rules; airport re-seed; FX CHECK and
    nano scale [dm-205, dm-206, dm-207, dm-209, dm-211, devops-002,
    devops-003, devops-004, dm-212, dm-213, prov3-018].
19. Roll-up row 0; `offers-dropped`; zero-legs step 2; stride edge cases;
    brackets; notes placement; zero-cell windows [strat-r3-010, prov3-011,
    prov3-010, strat-r3-011, strat-r3-018, strat-r3-017, strat-r3-014].
20. Tests: abort finalise, constraint-absent matrix, Stryker threshold, web
    branch floor, banned-word scope and word boundaries, first-failing-test
    column, chart states, refresh boundary values, `confirmed_cost` ceil,
    pre-start predicate, `ALLOWED_HOSTS` docs, compose logging/healthcheck,
    health degraded flag [test-r3-003…007, prov3-017, ui-007, ui-008,
    cost-309, cost-311, cost-312, devops-005, devops-006, devops-008,
    ui-004, prov3-009, pie3-004].

### Revision 3 against review 2 (140 findings)

See `.review-2.md`; every ID mapped in the revision-3 changelog, retained
in git history at commit 3cae750.

### Revision 2 against review 1 (145 findings)

See `.review-1.md`; mapped at commit 346f975.

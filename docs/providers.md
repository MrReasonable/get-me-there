# Flight data provider landscape — researched 2026-10-14

Researched 2026-10-14 by four parallel research passes. Re-verify pricing and ToS before relying on any number here; vendors change plans frequently.
Labels: VERIFIED = read on an official page; REPORTED = third-party; UNKNOWN = not found.

## Summary table

| Provider | Access for individual | Cost | Live/cached | Calendar endpoint | RT as one price | GBP | Booking link | Authorised source? | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| Amadeus Self-Service | **None** — decommissioned 2026-07-17 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | DEAD |
| Duffel | Account + card + balance top-up; business-oriented | $0.005/search above 1500:1 search:book ratio → every search billed if never booking; $3/order | Live (Travelport GDS + direct) | **No** | Yes | Billing currency | No consumer link; Orders API only | Yes, but **ToS 2.5(d) forbids metasearch use** | REJECT |
| SerpApi google_flights | Self-serve | Free 250/mo (50/hr); $25/1k; $75/5k; $150/15k | Google's live-ish results | **No** (roadmap frozen) | Yes, 1 call for cheapest RT total (REPORTED), 2 calls for both legs, 3 with booking options | Yes (`currency`) | Yes via booking_token (short-lived) | **Scrapes Google**; Google v. SerpApi litigation ongoing (amended complaint 2026-08-10) | Possible, legal grey |
| SearchApi.io google_flights + **google_flights_calendar** | Self-serve | Free 100; $40/10k; $100/35k; 20% of plan per hour max; only HTTP 200 billed | Google's results | **Yes** — up to 200 date pairs per call, multi-airport (≤10 per side) | Yes | Yes | Yes | **Scrapes Google** (same grey zone, not named in litigation that we found) | Best live/calendar option if scraping-derived data is acceptable |
| Travelpayouts / Aviasales Data API | Free with Travelpayouts account token | Free (no price published) | **Cached** from Aviasales user searches, 48h–7d old; the `market` parameter is ignored (spike) | **Yes** — `/v1/prices/calendar` (length of stay), `/v2/prices/month-matrix`, `/v3/prices_for_dates` (YYYY-MM ranges, one_way=false, 1000/page) | Yes | `currency=gbp` honoured (spike, 2026-10-14) | Aviasales deep link | **Yes** — authorised, caching encouraged, no ban on scheduled queries | Only free + authorised source. Coverage of thin long-haul routes UNKNOWN (depends on users having searched it) |
| Ignav | Self-serve | 1000 free once, then $2/1k successful (cache hits billed) | Claims live; `observed_at`, `cache_hit` | No | Yes | market=GB → GBP (implied) | Yes | **Undisclosed** "proprietary sources"; ToS page wouldn't load | Avoid until source verified |
| GoFlightLabs | Self-serve | $24.99/mo for 4k calls; 50-call trial | Unknown | No | Yes | No currency param | No | Undisclosed | Weak fallback |
| FlightAPI.io | Self-serve | $49/mo 30k credits (RT = 2 credits) | Unknown | No | Yes | Yes | Yes (URLs contain `client_id=skyscanner_website` → likely unauthorised Skyscanner resale) | Doubtful | REJECT |
| Kiwi Tequila | Invite-only since 2024-05 | — | — | — | — | — | — | — | CLOSED |
| Skyscanner Travel APIs | Partner-only, must drive bookings | — | — | — | — | — | — | — | CLOSED |
| Travelpayouts live Flight Search | Needs ≥50k MAU, bans automated collection | — | — | — | — | — | — | — | CLOSED |
| Trip.com, Travelfusion, Mystifly, Travelport, Sabre, airline NDC | Enterprise/IATA only | — | — | — | — | — | — | — | CLOSED |
| Google official API | None (QPX Express shut 2018-04-10) | — | — | — | — | — | — | — | NONE |
| fast-flights / google-flights-ts | Reverse-engineered `tfs` protobuf, direct to Google | free | — | — | — | — | — | **Unauthorised, fragile** | REJECT |
| `camoufox`: Google Flights read by Camoufox (the pinned build `gmt setup` or `gmt browser install` installs) that a host-side worker launches itself through `camoufox-js` | Self-scraped by this app from the address of the machine running the browser worker, in the worker's own signed-out profile; no vendor account | £0 in money; the operator's IP and selector upkeep; the operator is responsible for how it is used | `list` mode: the page as Google showed it when it was read (`maxAgeHours` 0); `grid` mode: Google's date grid, age not stated (assumed ≤24h) | `list` mode, one day pair a page; `grid` mode (opt-in, `CAMOUFOX_MODE=grid`), up to 49 day pairs a view | Yes | Yes (`curr=GBP`) | Google search link | Read the provider's terms before enabling it; the operator is responsible for how it is used | Discovery only, opt-in, off by default (continuity fallback); `list` built in WP14, `grid` in WP15 |

## Key facts with sources

### Amadeus (DEAD)
- Self-Service portal decommissioned 2026-07-17; test.api.amadeus.com no longer resolves (verified by agent DNS check); github.com/amadeus4dev archived 2026-07-17. Enterprise only now.
- Sources: https://github.com/amadeus4dev ; https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers ; https://dev.to/ishemah/amadeus-self-service-shut-down-on-july-17-heres-a-drop-in-replacement-for-flight-prices-1npn

### Duffel (REJECT)
- Pricing: https://duffel.com/pricing — searches free up to 1500:1 search:book, then $0.005/search; $3/order; 2% FX.
- Services agreement https://duffel.com/services-agreement — clause 2.5(d) no metasearch; 2.3 look-to-book enforced, 24h to comply or suspension (9.2(b)); 10.1 fares confidential.
- Rate limit default 10 req/60s (help article, ~3.5y old). No calendar endpoint. Test mode = synthetic "Duffel Airways" ZZ.
- Coverage: the national and connecting carriers via Travelport; BA/EK/LH/KL/AF direct; HO absent. https://duffel.com/flights/airlines
- Cost estimate, no bookings: ~6,550 searches per 2-origin sweep ≈ $33/sweep.

### SerpApi (possible, grey)
- Pricing https://serpapi.com/pricing — free 250/mo 50/hr; Starter $25/1k/200hr; Developer $75/5k/1000hr; Production $150/15k. Failed/cached searches not billed; cache 1h.
- Engine https://serpapi.com/google-flights-api — `departure_id`/`arrival_id` accept comma lists; `type=1` RT; `departure_token` → return legs; `booking_token` → booking options (`book_with`, `baggage_prices`, `booking_request.url`). `deep_search=true` mirrors browser (big accuracy difference in their example). `price_insights`: lowest_price, price_level, typical_price_range, price_history[[ts,price]] — may be null on thin routes.
- Per itinerary: layovers (duration, overnight flag), total_duration, extensions (baggage fee text); per segment flight_number, airplane, legroom.
- No calendar engine; roadmap issue #2487 "freezer". `google_travel_explore` is per-destination not per-date.
- Legal: https://serpapi.com/legal (updated 2026-08-27), https://serpapi.com/us-legal-shield (Production+ only, US law only). Google sued SerpApi Dec 2025; DMCA claims dismissed 2026-07-20 w/ leave to amend; amended complaint 2026-08-10; MTD 2026-08-25. https://searchengineland.com/google-loses-key-dmca-claims-against-serpapi-in-scraping-lawsuit-483185
- Status: avg 6.08s, 99.999% success (30d) https://serpapi.com/status/google_flights

### SearchApi.io (best scraping-derived option)
- Pricing https://www.searchapi.io/pricing — 100 free; Developer $40/10k; Production $100/35k; ≤20% of plan per hour; only HTTP 200 billed. The vendor's "Legal Protection Guarantee" comes with Production and above only, not with the Developer ($40) plan this app presets (pricing page, read 2026-10-17), which bears on the scraping-derived posture above.
- Dashboard after the spike (2026-10-14): "Remaining free searches (credits) 91" after eleven HTTP 200 calls, one 400 and one 401, so the free allowance is a one-off credit balance (not monthly), errors are not billed, and a repeat answered from the vendor cache was not billed either. Ian is subscribing to the $40 plan.
- `google_flights_calendar` https://www.searchapi.io/docs/google-flights-calendar-api — returns departure/return/price for up to 200 date pairs per call, comma-separated airports. Naive figure for a 181-day × 12-duration scan ≈ 11 calls assumes perfect packing; the API takes rectangular outbound×return ranges while the cell space is a diagonal nights band, so ~108 of 180 cells per call are useful and a realistic per-pair scan is ~20 calls. Spike to confirm.
- `google_flights` https://www.searchapi.io/docs/google-flights-api — ≤10 airports per side; same two-step RT flow as SerpApi.
- `show_cheapest_flights` (`google_flights`, docs read 2026-10-18 at https://www.searchapi.io/docs/google-flights-api): "Set to `true` to show the cheapest flights. By default, best flights are shown." The adapter sends `show_cheapest_flights=true` on every itinerary step (1, 2 and 3) beside `sort_by=price`, so step 1 chooses among Google's cheapest options rather than its default "best" set, which may leave a cheaper one out; "cheapest" still holds over the options SearchApi returns only. The page lists no other value, no extra cost (the pricing page bills each HTTP 200 search, whatever its parameters) and no change to the response: no example uses the parameter and no other section is named, and the adapter reads `best_flights` and `other_flights` either way, so a cheapest set arriving under either key is parsed. The `google_flights_calendar` page documents no such parameter, so discovery does not send it. It is in the dated allowlist `params-2026-10-18.json` from the docs, not from a recording: the 2026-10-15 recordings predate it, keep `params-2026-10-15.json` as the allowlist they were made under, and replay reaches them through the dated allowlist history (a request matching no recording exactly is matched again without the names added after the recording's own allowlist).
- Two behaviours the adapters rely on are not in either docs page (read 2026-10-17), only in the recordings: every HTTP 200 body echoes `search_parameters` (the adapters read `currency` and `gl` from it and fail every tile and step closed without it), and a calendar request above 200 combinations answers a descriptive HTTP 400, where the docs say "returns an empty response" (the replay tests pin the 400, so a change to an empty 200 fails them).
- Cache age: neither engine's docs page states how old a cached answer may be (read 2026-10-17). The calendar capability keeps a 24-hour bound as the app's own assumption, so its prices can age to stale like any other calendar price; the Providers page words it "assumed ≤24h (undocumented)", never as a vendor bound (plan decision 67, ruling 17). The itinerary capability declares the age unknown ("vendor's cache age unknown").
- `stops` (`google_flights`, docs read 2026-10-17): `nonstop`, `one_stop_or_fewer`, `two_stops_or_fewer`. The adapter sends it when a definition sets a max-stops rule of 0, 1 or 2 (plan decision 67, ruling 8), so billed calls go to itineraries the rule allows; above 2 it sends none. It is in the dated allowlist from the docs, not from a recording (the 2026-10-15 recording set no max-stops rule), and verdicts still check stops from the segments.

### Travelpayouts / Aviasales Data API (free, authorised, cached)
- Token: https://support.travelpayouts.com/hc/en-us/articles/203956083 (free with account).
- Rate limits (per minute, since 2024-06-14): 600 for /v3/prices_for_dates & /v3/grouped_prices; 300 for /v1/prices/calendar, /v2/prices/latest, /v2/prices/month-matrix; 60 week-matrix. https://support.travelpayouts.com/hc/en-us/articles/4402565416594
- Freshness: prices_for_dates/grouped_prices = found by users in last 48h; fields found_at, expires_at, actual. Other endpoints 2–7 days. https://support.travelpayouts.com/hc/en-us/articles/203956163
- Endpoints: /v1/prices/calendar?calendar_type=departure_date&length=N ; /v2/prices/month-matrix?trip_duration=<weeks> ; /v3/prices_for_dates?departure_at=YYYY-MM&return_at=YYYY-MM&one_way=false (1000/page). `currency` param (default RUB); `currency=gbp` is honoured (spike, 2026-10-14). The docs describe a `market` param for per-market data, but the spike found it ignored: the same rows come back whatever its value.
- Booking link: relative `link` prefixed with https://www.aviasales.com/ (affiliate deep-link tool).
- ToS: recommended for informing users/content pages; caching on your side encouraged; no ban on scheduled queries found.
- Live Flight Search API: ≥50k MAU required, bans automated collection, 9% conversion required → not usable.
- RISK: coverage of thin long-haul routes in `uk` market unknown; expect sparse. Needs a token + probe before committing.

### Camoufox provider (self-scraped, opt-in)

**Method.** A host-side worker (`apps/camoufox-worker`, a Node process on the machine running the worker; macOS or Linux, each
`<os>-<arch>` offered once recordings under its pinned build set its flags: all four today, `darwin-x64` in list mode only; Windows is a later
release) launches the Camoufox build `pnpm gmt setup` or `pnpm gmt browser install` installed from the pinned release through `camoufox-js` 0.11.5 and `playwright-core` 1.59.1, in a persistent signed-out
profile of its own, with service workers blocked. The app's adapter calls the worker over HTTP at `CAMOUFOX_WORKER_URL`
with `CAMOUFOX_WORKER_KEY`; one worker call makes at most one Google page load at
`https://www.google.com/travel/flights?q=Flights from <origin> to <destination> on <depart> returning <return>&curr=GBP&hl=en-GB&gl=<POINT_OF_SALE>`.
Before reading it checks the page's own search form (round trip, one adult, the query's dates) and waits until the page
is settled; it reads every result link's accessible name through Playwright locators (never printed accessibility
text), parses each with one dated grammar, keeps the options whose departure date and airports (matched by the airports
dataset's names) are the cell's, and takes the minimum itself. An option it cannot read is counted, never dropped
silently. It never calls the camofox-browser REST server.

**Evidence.**

- *Feasibility load, 2026-10-18* (signed in, through camofox-browser): the worked example's search loaded the full
  results with no challenge: a `tablist` with "Best" and "Cheapest from £451", "24 results returned.", lists "Top
  departing flights" and "Other departing flights" of `listitem`s each holding one `link` named with the whole option,
  the "Date grid" button, and the footer's "Currency GBP" and "Location·United Kingdom", all on the Best tab.
- *Signed-out test, 2026-10-18* (a fresh profile, since deleted): it landed on `consent.google.com` ("Before you
  continue", "Reject all" / "Accept all"), with no CAPTCHA and no "unusual traffic"; the results page that followed held
  26 result links in the same name grammar.
- Both loads ran through camofox-browser's own launch (humanised input, its cache preferences, uBlock Origin); the
  worker launches without them, so its own recordings (WP14 Task 14.2) are the evidence for its configuration.

**`camoufox-js` facts, read in source on 2026-10-18 (0.11.5).** `Camoufox({ user_data_dir })` returns a
`BrowserContext` from `firefox.launchPersistentContext`. Without `executable_path` it resolves the binary and
`properties.json` under its install directory, which it reads once from `CAMOUFOX_INSTALL_DIR`, and reads that
directory's `version.json` (`{version, release}`), starting an unawaited download when the directory is missing, empty
or unsupported. The worker's launcher (`run.ts`) sets `CAMOUFOX_INSTALL_DIR` itself, before anything imports
`camoufox-js`: on macOS the install root `~/.local/share/get-me-there/camoufox` (its `Camoufox.app` link to the pinned
bundle and its top-level `version.json`), on Linux the pinned bundle's own directory. `pnpm gmt setup` and
`pnpm gmt browser install` write that layout; the worker only verifies it (`release` required in the `version.json`
`camoufox-js` reads) and refuses (exit 78, `layout` or `build-mismatch`) on any difference, so the download branch is
never reached, and it never modifies the bundle. It passes
`ff_version` from the bundle with `i_know_what_im_doing: true`, `exclude_addons: ['UBO']` (no add-on download),
`geoip: false` (no IP lookup or GeoIP download), no proxy, no humanised input, headless, `serviceWorkers: 'block'`, its
own signal handling, six preferences that switch off telemetry, crash reports, Normandy and the captive-portal check,
and a minimal browser environment (`HOME`, `PATH`, `TMPDIR`, `LANG`), since without `env` the library passes the whole
process environment to the browser. Any other `camoufox-js` version or Camoufox build is refused at start.

**Limits.** One page at a time; at least `CAMOUFOX_MIN_SPACING_SECONDS` (default 30, 0 to 600, never randomised; a value of 0 means no pause: pages go back to back, from your own address; scrolls do so only when `CAMOUFOX_GRID_SCROLL_SPACING_SECONDS` is 0)
from the start of one page to the next, persisted across restarts; `CAMOUFOX_EXECUTION_PAGE_CAP` (default 100, at most
400) pages a run, frozen into the execution's snapshot; `CAMOUFOX_MONTHLY_PAGE_CAP` (default 1,500) a month. No
proxies; no challenge is ever solved, clicked through or waited out; consent is rejected, never accepted (the
operator's saved cookie choice, Reject all, is applied before every page and compared by value after it; a consent page
stops it). The worker stops and cools down whenever a page is not a recognised results page: a challenge or
verification page, a sign-in page, a signed-in control, a consent page or an off-allowlist navigation stops it for `CAMOUFOX_COOLDOWN_HOURS` (default 48,
at least 24); an unrecognised page for 1 hour.

**Costs.** **Terms:** Read the provider's terms before enabling it; the operator is responsible for how it is used. **The operator's IP and account:** every page
comes from the address of the machine running the worker, so a block lands on that address; the profile is never signed in. **Brittleness:**
a changed page reads as unrecognised and stops the provider for an hour; the selectors and grammar must be re-dated
against a new recording, and an upgrade of `camoufox-js`, `playwright-core` or the binary is a re-verification.
**Speed:** about 50–90 s a page at the default 30 s page spacing (`CAMOUFOX_MIN_SPACING_SECONDS`), so 100 cells a run
take about 1½–2½ hours. **Availability:** only while the machine running the worker is on and the worker runs; otherwise
its cells read skipped ("browser worker not reachable"). **Image size:** none in the app image; Camoufox stays on the
machine running the worker: a 313 MB download on `darwin-arm64` and 320 MB on `darwin-x64` (about 670 MB unpacked), 654 MB
on `linux-arm64` and 663 MB on `linux-x64` (about 1.25 GB unpacked). **The worker key:** any process or container that can reach the worker (on Docker Desktop, every container on the
Mac) is stopped only by `CAMOUFOX_WORKER_KEY`. **Money:** none.

**Coverage.** In `list` mode a page prices one day pair, so a run prices at most `CAMOUFOX_EXECUTION_PAGE_CAP` day pairs
and a month at most `CAMOUFOX_MONTHLY_PAGE_CAP`: with the defaults, 100 a run and 1,500 a month, against 2,184 day pairs
for one worked-example airport pair (8,736 for its four pairs). The `grid` mode (work package 15, opt-in with
`CAMOUFOX_MODE=grid`) reads up to 49 day pairs per view of the Dates tab's 7 × 7 grid: for one worked-example pair, 78
blocks on a lattice of 7 × 7 (26 departure columns × 3 return blocks for the 10–21-night band; 2,184 of their 3,822
cells are in the band and stored), 312 for the four pairs. One scroll moves one day (measured 2026-10-18), so a
block-to-block move is 7 scrolls, about 65 s, against about 30 s for a new page. With the defaults the run's estimate is
100 pages and 588 scrolls, about 2.4 hours, reading 5,152 of the 8,736 day pairs, and a full pass takes 3 runs; with
`CAMOUFOX_EXECUTION_PAGE_CAP=312` it is one run of 312 pages, about 2.6 hours (setup.md §14). Grid prices are whole
pounds, their return date is read from the grid cell, and Google's "cheapest price" and "low price" marks are shown as
Google's, for the prices in that view only.

**Provenance note, exactly as the app states it:** "Google Flights prices via Camoufox: the cheapest round-trip price Google Flights listed for this day pair when this app's own Camoufox browser read the page on the machine running this app's browser worker, from that machine's address, in the currency the page states. Return date: the date asked for, which the page's search form showed; the listed options state only the departure. The operator turned this provider on. Constraints are not checked; no return leg, seller or baggage is read."

In `grid` mode the note reads: "Google Flights date grid via Camoufox: the round-trip price Google's date grid showed for this day pair when this app's own Camoufox browser read the page on the machine running this app's browser worker, from that machine's address. The grid shows whole pounds; the exact fare may differ by under £1. Google's date grid; age not stated (assumed ≤24h). Return date: read from the grid cell, checked against the grid's return row. A "cheapest" or "low" mark means Google's date grid marked this price so among the prices shown in that view; it is Google's, not this app's. The operator turned this provider on. Constraints are not checked; no return leg, seller or baggage is read."

**Labels.** Display name "Google Flights via Camoufox"; source label "Google Flights prices via Camoufox"; compact mark
`CF`; source kind `scraped-self`, `maxAgeHours` 0 in `list` mode; in `grid` mode the source label is "Google Flights
date grid via Camoufox", `maxAgeHours` 24 (assumed), whole pounds, the return date from the grid cell; vendor links to
`google.com` only.

### Ignav
- https://ignav.com/pricing — 1000 free once, $2/1k successful, cache hits billed, spend cap. POST /api/fares/round-trip; /api/fares/booking-links; market=GB. Source undisclosed; ToS page JS-only. Markets itself as "Amadeus Self-Service replacement".

## Spike results (2026-10-14)

Measured with real tokens; the vendors' responses are not published (decision 61 keeps recorded vendor data out of the repository), so these are the findings. Travelpayouts holds no
UK-market cached round trips to a thin long-haul destination over eight months (busy gateways of the
same country: 4–6 a month); its `market` and `trip_class` parameters are ignored; `currency=gbp` works; rows carry
`origin_airport`/`destination_airport` but no `found_at`; one `prices_for_dates` call per
(destination, month) with `LON` covers every London airport. SearchApi's calendar engine fully
priced every probed thin route (126/126 cells), rejects city codes, returns HTTP 400 above 200
combinations, and takes 9–29 s per call; its itinerary chain showed an OTA £30 below the airline
fare at step 3, and some options carry no price. Both accept the key in a header.

## Implications for design
1. There is NO authorised, individual-accessible, live-pricing API in Oct 2026. Every live option is Google-scraping-derived.
2. The only authorised + free source (Travelpayouts) is cached and coverage-limited.
3. Therefore: provider interface must carry a `sourceKind: 'authorised-cached' | 'scraped-live' | ...` and `legalNote`, and the UI must label every price with its provenance.
4. Coverage probing is a zero-cost spike once tokens exist: Travelpayouts (free), SearchApi (100 free), SerpApi (250 free).
5. SearchApi calendar engine changes the economics: whole-space discovery is ~20 calls per origin/destination pair (rectangular tiling), so stage 1 can be Google's own date grid, not just Aviasales cache.

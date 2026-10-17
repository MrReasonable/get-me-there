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
| Self-scraping: Google Flights in a Camoufox (anti-detection Firefox) browser via Playwright | Self-run; no vendor account | Free software; residential proxies and selector upkeep are the real cost | Google's page | Yes (the date-grid page) | Yes | Yes | Yes | **Unauthorised; the operator carries the exposure directly** on their own server and IP | Phase 4 continuity fallback only (spec §2); not built |

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
- `show_cheapest_flights` (`google_flights`) is not sent: the adapter sorts by price (`sort_by=price`), so "cheapest" holds over the options SearchApi returns, and Google's default set may omit a cheaper option the parameter would reveal. Sending it changes what every paid call requests, so it is a named follow-up for the operator (plan decision 67, ruling 7; `docs/release-notes.md`).
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

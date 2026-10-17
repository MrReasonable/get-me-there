# Provider limits, plan presets and reconciliation

Every limit below is enforced by the app before a request leaves the process: the ledger
(`provider_requests`) records each attempt, and a request that would cross a cap is refused
before it is sent. Configuration lives in `.env` (see `.env.example`); this page explains
what the values mean. Provider facts were measured on 2026-10-14 and 2026-10-15 and come from
`docs/providers.md`; vendors change plans, so re-check their pages before relying on a number.

## Plan presets

`SEARCHAPI_PLAN` selects a preset (`trial` by default, or `40usd`); Travelpayouts has one set of
schema defaults. Each individual variable overrides its preset value. Money is configured in
pence and held in micro-GBP (1p = 10,000 µGBP). This table is generated from the code
(`PLAN_PRESETS`, `TRAVELPAYOUTS_DEFAULTS`) and a test fails if they drift apart.

<!-- preset-table:start -->
| Field | Override variable | SearchApi `trial` | SearchApi `40usd` | Travelpayouts (schema defaults) |
|---|---|---|---|---|
| `monthlyCallCap` | `SEARCHAPI_MONTHLY_CALL_CAP` / `TRAVELPAYOUTS_MONTHLY_CALL_CAP` | 100 | 10000 | 50000 |
| `window` | — (fixed by plan) | lifetime | month | month |
| `billingDay` | `SEARCHAPI_BILLING_DAY` / `TRAVELPAYOUTS_BILLING_DAY` | 1 | 1 | 1 |
| `ratePerMinute` | `SEARCHAPI_RATE_PER_MINUTE` / `TRAVELPAYOUTS_RATE_PER_MINUTE` | 2 | 10 | 200 |
| `ratePerHour` | `SEARCHAPI_RATE_PER_HOUR` / `TRAVELPAYOUTS_RATE_PER_HOUR` | 20 | 2000 | 10000 |
| `concurrency` | `SEARCHAPI_CONCURRENCY` / `TRAVELPAYOUTS_CONCURRENCY` | 1 | 2 | 4 |
| `cacheTtlHours` | `SEARCHAPI_CACHE_TTL_HOURS` / `TRAVELPAYOUTS_CACHE_TTL_HOURS` | 1 | 1 | 6 |
| `costPerCallMicroGbp` | `SEARCHAPI_COST_PER_CALL_MICRO_GBP` | 0 µGBP (0p) | 0 µGBP (0p) | 0 µGBP (0p) |
| `planFixedMicroGbp` | `SEARCHAPI_PLAN_FIXED_PENCE` | 0 µGBP (0p) | 32000000 µGBP (3200p) | 0 µGBP (0p) |
| `excludedFromSchedule` | — (fixed by plan) | true | false | false |
| `monthlySpendCapMicroGbp` | `MONTHLY_SPEND_CAP_PENCE` | 0 µGBP (0p) | 35000000 µGBP (3500p) | — |
| `executionMaxCalls` | `EXECUTION_MAX_CALLS` | 0 | 2000 | — |
| `executionMaxCostMicroGbp` | `EXECUTION_MAX_COST_PENCE` | 0 µGBP (0p) | 0 µGBP (0p) | — |
<!-- preset-table:end -->

How to read it:

- **`trial`** is SearchApi's one-off allowance of 100 credits. The window is the lifetime of
  the install, not a month, and scheduled runs leave SearchApi out; use it for the smoke test
  only. If some credits were spent elsewhere, set `SEARCHAPI_TRIAL_USED` to the number used
  (100 minus the dashboard's "Remaining free searches (credits)").
- **`40usd`** is the subscription. Each call costs 0 at the margin; the fee (£32, entered as
  3200p) is counted once in the global monthly cap, which defaults to 3500p, so
  `MONTHLY_SPEND_CAP_PENCE` reads as total monthly spend. The 10,000-call cap is the hard
  stop. The hourly rate of 2,000 is the vendor's "20% of the plan per hour" rule.
- **Travelpayouts** is free and never billed; its call cap only bounds load. The vendor allows
  600 requests a minute on this endpoint; the app defaults to 200.
- `EXECUTION_MAX_FREE_CALLS` (default 2000), `SOFT_CONFIRM_PENCE` (100) and
  `CHILD_MAX_CALLS` (6) are not plan-dependent and are not in the table.
- A billed provider whose calls cost money, enabled under a spend cap of 0, makes boot log a
  warning, and the Providers page says verification will not run. On the `trial` and `40usd`
  plans calls cost £0 at the margin, so the spend cap cannot stop a call: the Providers page
  names the call cap that does, and that call cap is the only stop. A `MONTHLY_SPEND_CAP_PENCE`
  below the subscription fees it counts makes boot log a warning naming the variable.
- `docs/scheduling.md` turns these caps into calls a run and a month for the worked example.

## Budget windows

Each provider's month starts on its `<PROVIDER>_BILLING_DAY` (UTC, 1–28, so every month has
the day); the global month starts on `GLOBAL_BILLING_DAY` (UTC, default 1). Set SearchApi's
billing day to the day your subscription renews so the app's month and the vendor's month
line up. `trial` uses a lifetime window. The Providers page and `GET /api/budget` show every
window's start and end with calls and cost so far.

## Per-provider facts

### Travelpayouts (Aviasales Data API): authorised, cached, free

- Endpoint `/aviasales/v3/prices_for_dates`, one logical request per (origin airport,
  destination airport, month) with `departure_at=YYYY-MM`, `one_way=false`, `currency=gbp`,
  up to 1000 rows a page and at most 3 pages a tile. The app never sends a city (metro) code:
  a metro query returns one cheapest row per date pair across every airport of the city, so a
  cheaper airport you did not choose would hide your own airport's fare. The worked example
  (2 origins, 2 destinations, 7 departure months) is 28 free calls a scan.
- Prices are Aviasales users' own recent searches. Each row's link carries the day the fare
  was found, which the app shows as its age; the vendor's declared 48-hour horizon is the
  fallback when that day is missing. The app labels these prices "Aviasales cache".
- The vendor ignores `market` (point of sale is recorded as unknown) and `trip_class`
  (economy only; other cabins return no data with a note).
- Coverage depends on what users searched: a thin long-haul route measured zero cached rows
  over eight months, busy gateways four to six a month. Run the coverage check on the
  Definitions form before relying on it.
- The token travels in the `X-Access-Token` header, never in a URL.

### SearchApi (Google Flights engines): scraping-derived, opt-in

- SearchApi obtains Google's results in a way Google's terms prohibit; the app uses it because
  the operator opted in (decision 2026-10-14) and labels its prices "Google date grid via
  SearchApi" (calendar) and "Google Flights via SearchApi" (itinerary search).
- `google_flights_calendar` (discovery): at most 200 date combinations per call (HTTP 400
  above that), one airport per side (city codes are rejected), 9 to 29 seconds per call. The
  app tiles 9 outbound days by the 20-day return span the 10–21-night band needs (180
  combinations), 21 calls per airport pair for the worked example's 182-day window, 84 for its
  4 pairs.
- `google_flights` (verification): three steps per cell, `1 + expandTop × 2` calls, 5 at the
  default `expandTop` of 2. Step 3 can show an online agency below the airline's fare, so it
  always runs. Some options carry no price and are skipped.
- Billing: only HTTP 200 responses count; error responses are not billed, and a repeat answered
  from the vendor's cache was not billed either (dashboard, 2026-10-14). The app's ledger counts
  every HTTP 200 attempt, so it can read higher than the dashboard, never lower.
- The key travels in an `Authorization: Bearer` header, never in a URL.

## Reconciling with the vendor dashboard

Once a week (or before raising a cap), compare the app with SearchApi's dashboard:

1. Open the Providers page (or `GET /api/budget`) and note SearchApi's calls in the current
   window and the window's start date.
2. Open SearchApi's dashboard and note the searches used in the same billing period
   (on `trial`, 100 minus "Remaining free searches (credits)").
3. Expect **app ≥ dashboard**. The gap is cached repeats and retries the vendor did not bill.
4. If the **dashboard is higher**, something outside this install used the key, or the
   database was restored from a backup (below). Lower `SEARCHAPI_MONTHLY_CALL_CAP` to
   `10000 − dashboard used` (or raise `SEARCHAPI_TRIAL_USED` on `trial`) in `.env` and run
   `docker compose up -d` until the next billing day.
5. Travelpayouts is free; there is nothing to reconcile, only the call counts on the
   Providers page.

## Restoring a backup resets month-to-date spend

The ledger lives in the database. Restoring a backup removes every ledger row written after
that backup, so the app believes fewer calls were made this month than the vendor counted.
After any restore, before the next run: read the dashboard, lower
`SEARCHAPI_MONTHLY_CALL_CAP` (or raise `SEARCHAPI_TRIAL_USED`) by the difference as in step 4
above, and put the cap back after the next billing day. The restore steps are in
`docs/setup.md`.

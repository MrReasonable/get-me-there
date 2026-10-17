# Scheduling

A definition with a schedule runs on its own; the app has one in-process scheduler and needs
no host cron for searches. Times are evaluated in the definition's time zone (`scheduleTz`,
which new definitions take from `SCHEDULER_TIMEZONE`, default `Europe/London`), so 05:00 stays
05:00 local across the clock changes.

## Cron examples

Five fields: minute, hour, day of month, month, day of week. The minute must be a single
number, so a schedule runs at most once an hour; anything more frequent is rejected when you
save.

| Cron | Meaning |
|---|---|
| `0 5 * * 1` | Mondays 05:00 (the default) |
| `0 5 * * 1,4` | Mondays and Thursdays 05:00 |
| `0 5 * * *` | every day 05:00 |
| `30 6 1,15 * *` | the 1st and 15th of the month 06:30 |

Avoid 01:00–02:59 in `Europe/London`: on the March change that hour does not exist and on
the October change it happens twice. Pick an hour outside it.

The definition's `discoveryRefreshHours` (default 168, one week) decides when a calendar price
is old enough to fetch again. A price younger than 90% of it is reused rather than refetched,
so a weekly schedule refreshes weekly, and a daily schedule under a 168-hour refresh fetches
calendars about five times a month and reuses them in between; itinerary search runs on every
firing. Lower `discoveryRefreshHours` to refresh calendars more often.

## Cadence and the call budget

The table below is computed by the app's own estimate and budget-fit functions, the ones the
Definitions form shows, for the worked example (London → New York: 2 origins × 2 destinations,
departures from 7 days ahead over 182 days, 10–21 nights). It was computed for a definition
saved on 14 October 2026: a window that spans a different number of calendar months plans a
different number of Travelpayouts calls, so the form's estimate is the figure for your own
definition. "Planned" is the call plan; the app reserves budget for it times the retry
factor. "Runs a month" is the number of firings in the next 365 days divided by 12, not
rounded. "Calls a month" is what the budget fit compares with each provider's monthly cap: on
a daily schedule it counts calendar fetches once per refresh period, not once a day. A test
regenerates the table and fails if this page and the code disagree.

<!-- cadence-table:start -->
| Configuration | Calls a run: planned → with the 1.2 retry factor | Runs a month | Calls a month (budgetFit) of the cap | Fits every cap |
|---|---|---|---|---|
| £0: Travelpayouts only, weekly | Travelpayouts calendar 28 → 34 | 4.33 | Travelpayouts 148 of 50,000 | yes |
| SearchApi `40usd`: both providers, weekly (the example) | Travelpayouts calendar 28 → 34; SearchApi calendar 84 → 101; SearchApi itinerary search 50 → 60 | 4.33 | Travelpayouts 148 of 50,000; SearchApi 698 of 10,000 | yes |
| SearchApi `40usd`: both providers, daily (`0 5 * * *`) | Travelpayouts calendar 28 → 34; SearchApi calendar 84 → 101; SearchApi itinerary search 50 → 60 | 30.42 | Travelpayouts 170 of 50,000; SearchApi 2,330 of 10,000 | yes |
| SearchApi `40usd`: both providers, weekly, `maxCells` 200 | Travelpayouts calendar 28 → 34; SearchApi calendar 84 → 101; SearchApi itinerary search 1,000 → 1,200 | 4.33 | Travelpayouts 148 of 50,000; SearchApi 5,638 of 10,000 | yes |
| SearchApi `trial`: both providers, weekly | Travelpayouts calendar 28 → 34; SearchApi calendar 84 → 101 (refused: over the provider-lifetime cap); SearchApi itinerary search 50 → 60 (refused: over the provider-lifetime cap) | 4.33 | Travelpayouts 148 of 50,000; SearchApi 0 (scheduled runs leave it out) | yes |
<!-- cadence-table:end -->

On `trial` the 100 lifetime credits cannot hold one full SearchApi run of the example, so a
manual run is refused for SearchApi and scheduled runs leave SearchApi out; `trial` is for the
smoke test.

When you save a definition, the form shows its budget fit: runs a month × the estimate,
compared with every cap. A warning there means the schedule will meet a cap before the month
ends; enabling a schedule whose provider month does not fit is refused.

## Pausing

- **Stop a schedule:** untick "enabled" on the definition (or `PUT /api/definitions/:id` with
  `"enabled": false`). The job is removed at once; turning it back on re-registers it.
- **Cancel a run in progress:** the Cancel button on the status bar. Cells not yet fetched go
  back to "not searched"; Resume continues from there later.
- **Paused by the app:** a run stops itself as `paused_budget` (a cap was reached) or
  `paused_error` (every provider failed, or the rate limiter's queue deadline passed). The
  status bar shows the reason. A pause on a provider or global cap resumes by itself when the
  cap window reopens; a pause on the run's own cap resumes only when you press Resume; an
  error pause with a known retry time resumes at that time; otherwise use Resume after fixing
  the cause.
- While any run is active or paused, the next scheduled firing does not start a second run;
  the status bar shows "schedule blocked since <date>". A paused run older than
  `discoveryRefreshHours` is cancelled at the next firing and a fresh run starts.

## Missed firings

The scheduler does not catch up. If the host was off or asleep at 05:00 on Monday, that run
is skipped. On the next boot the app records an execution with status `skipped_missed` and
sends an operator notification, so the gap is visible in the run history; the next firing
runs normally. To run now, use "Run now" on the definition.

A run that a container restart interrupts is marked `interrupted` and resumes on boot (up to
`MAX_AUTO_RESUMES` times without progress, default 3). `docker compose stop` gives the app
30 seconds to stop its run and release the database cleanly.

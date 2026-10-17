# Release notes

## v0.1.0

The first release: the design spec's Phases 1 to 3. One self-hosted container finds the
cheapest round trip across a window of departure dates and a range of stays, with the source
and age of every price on show and coverage stated bucket by bucket. The worked example is
London → New York (LHR, LGW to JFK, EWR). Start with `docs/setup.md` section 1.

### Known limits and follow-ups

- **SearchApi `show_cheapest_flights` is not sent.** The itinerary search asks Google Flights
  for its options sorted by price, so "cheapest" holds over the options SearchApi returns;
  Google's default set may leave out a cheaper option that `show_cheapest_flights` would
  reveal. Sending it changes what every paid call requests, so it is a follow-up for the
  operator to decide (plan decision 67, ruling 7; `docs/providers.md`).
- **On-demand itinerary search needs a run cap above 0 calls.** A definition whose run cap is
  0 billed calls (the trial preset) gets no on-demand child; raise its call cap to verify a
  cell from the Calendar (ruling 9).
- **Recording-dependent suites skip in CI.** Recorded vendor responses never enter git, so the
  tests that replay them run only on a machine that holds the recordings; that local run is
  the gate for provider and engine changes (`docs/setup.md` section 8).
- **SearchApi's credits-exhausted answer has not been recorded.** A 402, or a 403 or 429 that
  names credits or quota, is treated as quota exhaustion and never retried.

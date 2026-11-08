// Builders for the Searches contract tests (WP20 Task 20.1). Worked example only: London → New York (LHR, LGW → JFK,
// EWR), a relative window from a week out for 182 days, stays of 10 to 21 nights, as spec §11's form defaults.
// Values are the wire's input shapes (plain strings), so every test parses what a client or the api would send.

/** The worked-example card: a manual run that searched 384 of 405 date pairs, priced from the Aviasales cache. */
export function searchCard(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'def-london-new-york',
    name: 'London to New York',
    origins: ['LHR', 'LGW'],
    destinations: ['JFK', 'EWR'],
    window: cardWindow(),
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    schedule: null,
    discovery: ['travelpayouts', 'camoufox'],
    latestRun: latestRun(),
    spaceChangedSince: false,
    cheapest: cardCheapest(),
    ...over,
  };
}

/** The card's window: relative, a week out for 182 days, resolved on 2027-02-28. */
export function cardWindow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'relative',
    departureFrom: '2027-03-07',
    departureTo: '2027-09-04',
    startOffsetDays: 7,
    lengthDays: 182,
    ...over,
  };
}

/** The card's cheapest figure: £312 on LHR → JFK, 14 to 24 Mar 2027, from the Aviasales cache, found by the latest run. */
export function cardCheapest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pricePence: 31_200,
    provenance: {
      providerId: 'travelpayouts',
      sourceKind: 'authorised-cached',
      fetchedAt: '2027-02-28T09:12:00.000Z',
      maxAgeHours: 48,
      fx: { converted: false },
      pointOfSale: 'unknown',
      cabin: 'economy',
    },
    stale: false,
    ageHours: 50,
    truncated: false,
    basis: 'calendar',
    priceKind: null,
    departureDate: '2027-03-14',
    returnDate: '2027-03-24',
    origin: 'LHR',
    destination: 'JFK',
    fromLatestRun: true,
    ...over,
  };
}

/** The card's latest run: completed, 384 of 405 date pairs searched, 21 never searched, 10 flight lists read. */
export function latestRun(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'exec-1',
    status: 'completed',
    trigger: 'manual',
    startedAt: '2027-02-28T09:12:00.000Z',
    finishedAt: '2027-02-28T11:41:00.000Z',
    datePairs: 405,
    datePairsSearched: 384,
    datePairsNeverSearched: 21,
    flights: { planned: 10, read: 10, reused: 0, failed: 0, ended: null, confirm: null, stopCause: null },
    estimatedFinishAt: null,
    stop: null,
    ...over,
  };
}

/** A create-and-start body for the worked example: free sources only, so the shown totals are £0 and 0 calls. */
export function createAndStartBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'London to New York',
    origins: ['LHR', 'LGW'],
    destinations: ['JFK', 'EWR'],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    constraints: { maxJourneyMinutes: 1500 },
    verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
    providers: {
      discovery: ['travelpayouts'],
      verification: [],
      discoveryRefreshHours: { travelpayouts: 168 },
    },
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: null,
    scheduleTz: 'Europe/London',
    enabled: false,
    confirmCostPence: 0,
    confirmCalls: 0,
    requestKey: '3f6c1d2e-8a4b-4c5d-9e6f-7a8b9c0d1e2f',
    ...over,
  };
}

/** The stored search a create-and-start answers with (definitionResponseSchema's input shape). */
export function definitionResponse(over: Record<string, unknown> = {}): Record<string, unknown> {
  const { confirmCostPence: _p, confirmCalls: _c, requestKey: _k, ...fields } = createAndStartBody();
  return {
    ...fields,
    id: 'def-london-new-york',
    confirmedCostPence: 0,
    confirmedCalls: 0,
    createdAt: '2027-02-28T09:12:00.000Z',
    updatedAt: '2027-02-28T09:12:00.000Z',
    deletedAt: null,
    budgetFit: { fits: true, runsPerMonth: 0, perScope: [] },
    estimate: null,
    needsConfirmation: null,
    notices: [],
    ...over,
  };
}

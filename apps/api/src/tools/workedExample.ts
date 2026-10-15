/**
 * The public worked example's route (brief README, spec §1): the only route the committed recorded tree may hold.
 * why: the privacy rule — the operator's own route never enters the repository, so a run that would write into the
 * committed tree with any other route is refused (sec2-002). This is the one apps/api source file that names airports
 * (the WP4b definition-of-done grep excludes it), as apps/web/src/example.ts is for the web.
 */
export const WORKED_EXAMPLE_ROUTE = { origins: ['LHR', 'LGW'], destinations: ['JFK', 'EWR'] } as const;

/** True only for exactly the worked example's route, in its order: `LHR,LGW:JFK,EWR`. */
export function isWorkedExampleRoute(a: {
  origins: readonly string[];
  destinations: readonly string[];
}): boolean {
  const same = (x: readonly string[], y: readonly string[]): boolean =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  return (
    same(a.origins, WORKED_EXAMPLE_ROUTE.origins) && same(a.destinations, WORKED_EXAMPLE_ROUTE.destinations)
  );
}

/** `LHR,LGW:JFK,EWR`, for messages. */
export const WORKED_EXAMPLE_ROUTE_ARG = `${WORKED_EXAMPLE_ROUTE.origins.join(',')}:${WORKED_EXAMPLE_ROUTE.destinations.join(',')}`;

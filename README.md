# get-me-there

A self-hosted flight price optimiser for one operator: it searches a window of departure dates
and a range of stays for the cheapest round trip, within a stated budget of vendor calls. The
worked example throughout is London → New York.

**On your own Mac or Linux machine:** `corepack enable && pnpm install && pnpm gmt setup`
installs the app as a user service; [`docs/setup.md`](docs/setup.md) section 0 is the quick
start.

**In a container (a VPS, or Docker Desktop on a Mac):** start with
[`docs/setup.md`](docs/setup.md) section 1 — the app refuses to start without basic auth, and
that section says which two lines to put in `.env`. On a Mac with Docker Desktop, double-click
`Start.command`, then open <http://127.0.0.1:3000>; see
[the short Docker guide](docs/local-quickstart.md).

- [`docs/setup.md`](docs/setup.md): install, configure, back up, operate, the smoke test.
- [`docs/local-quickstart.md`](docs/local-quickstart.md): Docker Desktop on a Mac via `Start.command`.
- [`docs/api-limits.md`](docs/api-limits.md): plan presets, caps and reconciling with the
  vendors' dashboards.
- [`docs/scheduling.md`](docs/scheduling.md): what a schedule costs in calls a run and a month.
- [`docs/providers.md`](docs/providers.md): the provider research and the known vendor behaviour.
- [`docs/release-notes.md`](docs/release-notes.md): what this release does and does not do.

Every price is shown with its source and age; nothing is invented, converted without saying so,
or presented as more certain than its source. Coverage is stated cell by cell: a cell with no
cached data is never counted as having no flights.

# get-me-there

A self-hosted flight price optimiser for one operator: it searches a window of departure dates
and a range of stays for the cheapest round trip, within a stated budget of vendor calls. The
worked example throughout is London → New York.

**Start with [`docs/setup.md`](docs/setup.md) section 1**: the app refuses to start without
basic auth, and that section says which two lines to put in `.env`.

- [`docs/setup.md`](docs/setup.md): install, configure, back up, operate, the smoke test.
- [`docs/api-limits.md`](docs/api-limits.md): plan presets, caps and reconciling with the
  vendors' dashboards.
- [`docs/scheduling.md`](docs/scheduling.md): what a schedule costs in calls a run and a month.
- [`docs/providers.md`](docs/providers.md): the provider research and the known vendor behaviour.
- [`docs/release-notes.md`](docs/release-notes.md): what this release does and does not do.

Every price is shown with its source and age; nothing is invented, converted without saying so,
or presented as more certain than its source. Coverage is stated cell by cell: a cell with no
cached data is never counted as having no flights.

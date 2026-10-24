# Docker Desktop on this Mac

Until `pnpm gmt setup` ships (WP16b), Docker is the working local path. The native
wizard and `docs/setup.md` section 0 land with that CLI. Prefer Docker for now, or when
you want the container:

1. Open Docker Desktop and wait until it is running.
2. Create `.env` next to `docker-compose.yml` if you do not have one yet
   ([`setup.md`](setup.md) section 1 for basic auth, section 2 for the £0 three-line form).
3. Double-click `Start.command` in the project folder (or run `./Start.command` in Terminal).
4. Open <http://127.0.0.1:3000> and sign in with `APP_BASIC_AUTH_USER` and
   `APP_BASIC_AUTH_PASS` from that `.env` file.

The launcher checks that Docker is up, refuses to print the resolved compose config (it holds
credentials), builds and starts the `app` service, waits until it is healthy (up to 4
minutes, matching the image health-check start period), and leaves it running in the
background. Run it again after code changes; it reuses the existing database.
You do not need to install Node or pnpm for this path. If macOS declines to open the command
file, run it from Terminal.

Put your own airports in the Definitions form, never in a file of this repository. The worked
example throughout the docs is London → New York. Before a larger search, review the estimate
and each provider's remaining allowance; do not raise a call cap without checking that
allowance. Calendar prices are indicative; only seller-confirmed results have passed the final
verification step, and prices can still change before booking.

To stop: run `docker compose stop app` from this folder. To restart: double-click
`Start.command`. Keep Docker Desktop running while searching. Do not use
`docker compose down -v`: it deletes the database and its usage ledger.

If a provider reports an invalid or expired key, replace only its value in `.env` and run the
launcher again. Do not paste credentials into chat or commit them.

Backups sit on the compose volume at `/data/backups`, not under a host `data/backups/`
folder. To keep a copy off this machine, follow [`setup.md`](setup.md) section 6: run
`docker compose exec -T app node scripts/backup.mjs`, then
`docker compose cp app:/data/backups/. /Volumes/<other disk>/get-me-there-backups` (a private folder on another disk). The longer
setup guide also covers optional email, scheduled backups, moving to the native path
(`pnpm gmt setup --import-docker` once the CLI lands), and remote access.

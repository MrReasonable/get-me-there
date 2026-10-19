# Setup

This gets one container running on a machine you control, reachable only by you, with a
daily backup. Everything below uses the worked example London → New York; put your own
airports in the Definitions form, never in a file of this repository.

## 1. Authentication first

The container listens on all interfaces inside Docker, compose publishes it on
`127.0.0.1:3000` only, and the app refuses to start without basic auth. Create `.env` next to
`docker-compose.yml`, readable by you alone, with a password nobody else has seen:

```bash
openssl rand -base64 24       # prints a random password; use it below
touch .env && chmod 600 .env
```

```dotenv
APP_BASIC_AUTH_USER=operator
APP_BASIC_AUTH_PASS=CHANGE-ME
```

Replace `CHANGE-ME` with that random value (the app needs at least 12 characters, so the
placeholder itself is refused). If a value contains `$`, wrap it in single quotes, because
compose interpolates `$` in `.env`.

These are the two lines the app asks for when they are missing. If `docker compose logs app`
shows exit 78 with "add two lines to .env: APP_BASIC_AUTH_USER=<a user name> and APP_BASIC_AUTH_PASS=<a password of at least 12 characters> (docs/setup.md section 1)",
add exactly these two lines and run `docker compose up -d` again. Do not set
`ALLOW_UNAUTHENTICATED` in `.env`: compose does not forward it (section 3 is the only way to run
without auth).

Basic auth sends the password with every request. Over plain HTTP that is only acceptable on
loopback. To reach the app from another device, put TLS in front of it (section 3).

Anyone who can run `docker` on this host can read the container's environment, keys included
(`docker inspect`), so treat membership of the `docker` group as root and keep this host to
yourself.

## 2. The £0 configuration: three lines

Get a free Travelpayouts token (Travelpayouts account → API token) and add it:

```dotenv
TRAVELPAYOUTS_TOKEN=your-travelpayouts-token
APP_BASIC_AUTH_USER=operator
APP_BASIC_AUTH_PASS=CHANGE-ME
```

That is the whole `.env` for £0. Then:

```bash
docker compose up -d --build --wait --wait-timeout 120
docker compose ps                     # "healthy"
```

If it has not reported healthy after 2 minutes, run docker compose logs app: a configuration
refusal (exit 78) names what to fix and restarts until you do. If the log shows the app still
starting (a lock wait or the first airport seeding), `docker compose ps` turns `healthy` within
the 4-minute start period.

Open <http://127.0.0.1:3000> and sign in. Then set up the daily backup of section 6 before
you rely on the app.

What £0 gives: calendar prices from the Aviasales cache only, every row labelled "constraints
not checked", and coverage that depends on what Aviasales users searched recently. Before you
save a definition, press **Coverage check** on the form: it shows cached rows per airport pair
and month, at no cost.

To add SearchApi later (the $40 plan, scraping-derived; see `docs/api-limits.md`):

```dotenv
SEARCHAPI_KEY=your-searchapi-key
SEARCHAPI_PLAN=40usd
SEARCHAPI_BILLING_DAY=1      # the day of the month your subscription renews (1–28)
```

then `docker compose up -d`. Without `SEARCHAPI_PLAN=40usd` the key runs on the one-off
`trial` allowance and scheduled runs leave SearchApi out. On the trial plan new definitions
allow 0 billed calls per run, so Verify in the calendar is unavailable until you raise the
definition's call cap in Definitions → Run budget (Max billed calls per run); 6 covers one
cell. If `.env` has a `SEARCHAPI_TRIAL_USED` line from the trial, delete it (or set it to 0):
on `40usd` the app refuses to start with it (exit 78).

**Secrets are kept only in `.env`.** The repository's `.gitignore` keeps `.env` and every
`.env.*` file except `.env.example` out of git, `.dockerignore` keeps them out of the image,
and compose passes the container only the variables it lists (never the whole file), so a key
reaches the app and nothing else. Never put a key in `docker-compose.yml`, in a command line or
in a definition. The database holds no key or password; back up `.env` separately and keep it
private.

Never put `NODE_ENV`, `IN_CONTAINER` or `ALLOW_FIXTURE_PROVIDER` in `.env` for the container:
compose does not pass them (the image sets the first two), and fixture data cannot be enabled
in a container. `DATABASE_PATH`, `PORT` and `BIND_ADDRESS` are fixed in `docker-compose.yml`;
setting them in `.env` changes nothing (section 3 says how to use another host port).

**Publishing the repository.** The repository holds no key and no vendor response: `.env` and
every recording under `packages/providers/fixtures/recorded/` are ignored by git (only our own
`params-*.json` allowlists are tracked), and the commits that once held recordings were purged
from history. Before you make it public, check both, from the repository root:

```bash
git ls-files packages/providers/fixtures/recorded
git log --all --format= --name-only -- packages/providers/fixtures/recorded | sort -u
```

Each must list only `params-*.json` and `.gitkeep` files. Never force-add a recording.

## 3. Reaching it from other devices: ALLOWED_HOSTS and TLS

The app rejects any request whose `Host` header is not in `ALLOWED_HOSTS`, and the error names
the header value and the variable. The default is `localhost:3000,127.0.0.1:3000`. Setting the
variable replaces the default, so list every hostname you will type in a browser, including
the local ones if you still use them.

Keep the port mapping on `127.0.0.1` and put `tailscale serve` or a reverse proxy in front.
Changing it to `3000:3000` or `0.0.0.0:3000:3000` publishes the app to every network the host
is on, past a host firewall such as ufw (Docker writes its own packet-filter rules). If the
port is reachable, basic auth is the only barrier between a stranger and your API budget. To
use another host port, change only the left side: `127.0.0.1:8080:3000`.

**Tailscale** (the app stays off the public internet):

```bash
tailscale serve --bg 3000
```

```dotenv
ALLOWED_HOSTS=gmt-host.tail0000.ts.net,localhost:3000,127.0.0.1:3000
TRUST_PROXY=true
```

`tailscale serve` terminates TLS with a certificate for your tailnet name and forwards to
`127.0.0.1:3000`. Use your machine's own `*.ts.net` name.

**Reverse proxy** on a VPS, here Caddy, which obtains a certificate automatically:

```caddyfile
flights.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

```dotenv
ALLOWED_HOSTS=flights.example.com
TRUST_PROXY=true
```

`TRUST_PROXY=true` makes the failed-login rate limit read the client address from
`X-Forwarded-For`; set it only when a proxy you control sits in front and is the only way in.
On a host shared with other users it lets any of them, through the loopback port, claim any
client address and dodge that limit; use it on a single-user host.

**Without basic auth, Tailscale only.** The default compose always keeps auth on: it does not
pass `ALLOW_UNAUTHENTICATED` to the container. On a host that nothing but your tailnet can
reach, you may turn auth off with an override file next to `docker-compose.yml`, named
`tailscale-only.yml`:

```yaml
# tailscale-only.yml: only on a host reachable from nothing but your tailnet.
services:
  app:
    environment:
      ALLOW_UNAUTHENTICATED: "true"
```

and in `.env`, with the two auth lines removed:

```dotenv
COMPOSE_FILE=docker-compose.yml:tailscale-only.yml
```

Compose then reads both files for every command. Remove the line (and put the auth lines back)
the moment the host is reachable any other way.

## 4. Alert email

Without email settings, alerts and operator messages go to the log only, and the Alerts view
records each such alert as suppressed ("email not configured"). To send email, set all of
these (all or nothing; boot names any that is missing):

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_TLS=implicit            # implicit (port 465) or starttls (port 587, TLS required)
SMTP_USER=operator@example.com
SMTP_PASS=your-smtp-password
ALERT_EMAIL_TO=operator@example.com
ALERT_EMAIL_FROM=get-me-there@example.com
```

`ALERT_EMAIL_TO` and `ALERT_EMAIL_FROM` take one address each. `SMTP_TLS=none` is accepted only for a loopback host,
and inside the container, loopback is the container itself, so a mail catcher on the host is
unreachable and mail fails when it is sent; use `implicit` or `starttls` here (`none` is for the
local mail catcher of section 12). `ALERT_EMAIL_MAX_PER_HOUR`
(default 20) caps outgoing email: beyond it a message is logged and dropped, and the alerts it
carried stay queued with the reason shown in the Alerts view. Only emails sent (or being sent) count: a failed send
does not use up the hour, so an SMTP outage shows its own error, never "ceiling reached".

Set `APP_BASE_URL` to the `https://` address you type (for example
`APP_BASE_URL=https://flights.example.com` or your `https://…ts.net` name) so alert emails
link straight to the results row; left empty, emails carry relative links.

## 5. Import the example definition

On the Definitions page choose **Import example**, or paste this JSON into the import box:

<!-- example-definition:start -->
```json
{
  "name": "London → New York (example)",
  "origins": ["LHR", "LGW"],
  "destinations": ["JFK", "EWR"],
  "window": { "kind": "relative", "startOffsetDays": 7, "lengthDays": 182 },
  "minNights": 10,
  "maxNights": 21,
  "cabin": "economy",
  "constraints": {
    "maxJourneyMinutes": 1500,
    "arrivalWindowLocal": { "from": "06:00", "to": "23:00" }
  },
  "verification": {
    "maxCells": 10,
    "topN": 10,
    "alwaysInclude": [],
    "expandTop": 2,
    "bookingLinks": true
  },
  "budget": { "maxCalls": 2000, "maxFreeCalls": 2000, "maxCostMicroGbp": 0 },
  "providers": {
    "discovery": ["travelpayouts", "searchapi"],
    "verification": ["searchapi"],
    "discoveryRefreshHours": { "travelpayouts": 168, "searchapi": 168 }
  },
  "destinationNotes": {},
  "onwardCostPence": {},
  "scheduleCron": "0 5 * * 1",
  "scheduleTz": "Europe/London",
  "enabled": true
}
```
<!-- example-definition:end -->

It searches 2 origins × 2 destinations, departures from 7 days ahead over 182 days, stays of
10 to 21 nights (8,736 date pairs), every Monday at 05:00 London time. Itinerary search runs
on the 10 cheapest calendar cells with 2 outbound options each. `docs/scheduling.md` shows what
that costs in calls a run and a month.

On the £0 configuration, replace the `providers` block before importing:

```json
"providers": { "discovery": ["travelpayouts"], "verification": [], "discoveryRefreshHours": { "travelpayouts": 168 } }
```

The form shows the estimate before you create the definition; creating it is your
confirmation of that cost.

## 6. The data directory and backups

The database is one file on the named volume `get-me-there_gmt-data`, `/data/get-me-there.db`
inside the container, and its backups go to `/data/backups` (the `backups` folder beside
`DATABASE_PATH`). The image runs as the unprivileged user `node` (uid 1000), which owns
`/data`; backups are readable by that user only.

**The volume is the only copy until you copy backups off it.** `/data/backups` lives in the
same volume as the database, so it dies with it. `docker compose stop`, `restart` and `down`
keep the volume. These destroy it, with the database, the spend ledger and every in-volume
backup: `docker compose down -v`, `docker volume rm get-me-there_gmt-data`, and
`docker system prune --volumes` or `docker volume prune`. Never run them on this host unless
you mean to start from nothing.

The app backs the database up by itself before applying a schema migration (on an upgrade)
and refuses to start if that backup fails. A backup on demand runs the same routine:

```bash
docker compose exec -T app node scripts/backup.mjs
```

It writes `/data/backups/get-me-there-<UTC timestamp>.db` with SQLite `VACUUM INTO` (safe
while the app runs), checks it with `PRAGMA integrity_check`, refuses to overwrite an existing
file, keeps the newest 5, prints one line `{"ok":true,"file":"…"}`, and exits 74 on any
failure (section 10).

**Daily backup, copied off the volume.** Create a private folder for the host copies once:

```bash
sudo install -d -m 0700 -o operator /var/backups/get-me-there
```

Then add a cron job, for example `/etc/cron.d/get-me-there` (adjust the user, the path of
your checkout and the address). The cron user must be in the `docker` group (which is root on
this host, section 1), or put the same line in root's crontab; the `docker compose exec` still
runs as `node` inside:

```cron
MAILTO=operator@example.com
15 3 * * * operator cd /opt/get-me-there && umask 077 && out="$(docker compose exec -T app node scripts/backup.mjs)" && logger -t get-me-there-backup "$out" && docker compose cp app:/data/backups/. /var/backups/get-me-there/ && new="$(echo "$out" | sed -n 's/.*"file":"[^"]*\/\([^"/]*\)".*/\1/p')" && test -n "$new" && test -s "/var/backups/get-me-there/$new" && find /var/backups/get-me-there -name 'get-me-there-*.db' -mtime +30 -delete
```

`umask 077` keeps the host copies readable by you alone (they hold your whole price and alert
history and your alert addresses). Each step runs only if the one before succeeded. The prune runs only when the new backup is on the host and not empty: the line takes the new file's name from the backup's output and checks the host copy, because `docker compose cp` succeeds even when it copies nothing. The backup line goes to the system log
(`journalctl -t get-me-there-backup`); a failing step makes cron mail its error to `MAILTO`, if the host can
send mail. If it cannot, append `&& curl -fsS https://hc-ping.com/<your-check-id>` (or any
dead-man's-switch service) so you hear about a backup that did not happen. The thing to watch
is the age of the newest file in `/var/backups/get-me-there`: older than a day means the job
is failing. That keeps 5 copies in the volume and 30 days on the host.

**Off-box copy**: a backup on the same disk does not survive the disk. Send the host copies to
storage only you can read, for example:

```bash
rsync -a /var/backups/get-me-there/ backup-host:get-me-there/
```

### Restore

1. Pick the backup and stop the app: `docker compose stop app`.
2. Copy the backup into the volume as the app's user, so it has the right owner whoever owns
   the host copy, and check it before anything is replaced:

   ```bash
   docker compose run --rm --no-deps -T --entrypoint sh app -c 'cat > /data/restore.db' \
     < /var/backups/get-me-there/get-me-there-2026-10-14T03-15-00-000Z.db
   docker compose run --rm --no-deps -T --entrypoint node app scripts/check-backup.mjs /data/restore.db
   ```

   The check prints `{"ok":true,…}`; on exit 74 the backup is damaged: delete
   `/data/restore.db` the same way and pick another.
3. Put the current database aside (never delete it) and swap the backup in:

   ```bash
   docker compose run --rm --no-deps -T --entrypoint sh app -c 'cd /data &&
     for f in get-me-there.db get-me-there.db-wal get-me-there.db-shm; do
       if [ -e "$f" ]; then mv "$f" "$f.pre-restore"; fi
     done && mv restore.db get-me-there.db'
   ```

4. Start and check: `docker compose up -d --wait --wait-timeout 120`, then `curl -fsS http://127.0.0.1:3000/api/health`.
   Delete the `*.pre-restore` files once you are satisfied.
5. Restoring resets month-to-date spend: ledger rows written after the backup are gone. Lower
   the caps and reconcile with the vendor dashboard before the next run, as described in
   `docs/api-limits.md` ("Restoring a backup resets month-to-date spend").

**Docker Desktop (macOS, Windows):** keep the database on the named volume. Bind-mounting a
host folder over `/data` goes through Docker Desktop's file-sharing layer, where SQLite's WAL
locking is not reliable and the database can be corrupted. On a Linux host a bind mount works
if the directory is owned by uid 1000; the app stops at boot with exit 73 and a message naming
the directory if it cannot write there, or if its file system cannot hold SQLite's WAL journal.

## 7. Expected database growth

These are estimates from the row counts of one run of the worked example (8,736 cells); the
daily maintenance job logs the measured database size (`dbBytes`), which is the number to
trust.

| Configuration, weekly schedule | Rows per run | Approximate growth |
|---|---|---|
| £0 (Travelpayouts only) | ~8,700 cell rows + ~8,700 outcome rows + a few hundred prices | ~4 MB a run, ~20 MB a month |
| $40 (both providers) | ~8,700 cell rows + ~26,000 outcome rows + up to ~8,700 calendar prices + ~100 itinerary observations | ~11 MB a run, ~50 MB a month |

Growth scales with cells (origins × destinations × window days × nights) and with runs per
month. Expired cache rows and old cache-hit ledger rows are pruned daily; run history is
kept, so a year of the $40 example is roughly 600 MB. Deleting a definition or an alert rule
only marks it deleted: its runs, prices and alert events stay in the database and in History.

## 8. Fixture recording

Fixture recording is a development task, not an operations one, and never runs in the
container (the app refuses it there). Recorded vendor responses are local-only and never
committed: SearchApi's results come from Google Flights and Travelpayouts' from the Aviasales
cache, and neither may be republished. Git ignores everything under
`packages/providers/fixtures/recorded/` except our own `params-*.json` parameter allowlists, the
image never contains a recording, and a recording exists only on the disk of the machine that
made it (keep your own private copy outside the repository if you want one). Record on a
development checkout with the app stopped, worked example only (any other route needs
`--out DIR` outside the repository), and look at the plan first with `--dry-run`:

```bash
pnpm record:fixtures --budget 12 --route LHR,LGW:JFK,EWR --month 2027-03 --dry-run
pnpm record:fixtures --budget 12 --route LHR,LGW:JFK,EWR --month 2027-03
```

Recording spends SearchApi credits up to `--budget` (choose a month inside the next year).

Because the recordings never enter git, the test suites that replay them (the SearchApi and
Travelpayouts replays, the parameter allowlists against the recording, the engine's layer B and
the worked-example manifest) skip in CI and say so by title. They run in full only on a machine
that holds the recordings, so that local `pnpm -r --workspace-concurrency=1 test` is the gate
for any change to a provider adapter or the engine: run it before merging such a change
(plan decision 67, ruling 12).

## 9. One app per database, one user for every process

- **One app.** The app holds a lock in the database and renews it every 30 seconds. A second
  app started on the same database (a second compose project on the same volume, or
  `docker compose run app` while `app` is up) waits up to 90 seconds and then exits 75; it never
  takes the lock from a running app.
- **After a stop.** A graceful stop (`docker compose stop`, `restart`, `down`) releases the
  lock, so the next start does not wait. After a hard stop (a crash, `docker kill`, power loss)
  the lock is left behind: the next start logs `waiting for app_lock` with the lock's age for
  up to 90 seconds, until three renewals have been missed, then logs `taking over a stale
  app_lock` and boots. The health check's start period allows for that wait.
  A graceful stop that hangs does not have to end that way: the app gives its shutdown 25 seconds
  (inside compose's 30-second grace period), then logs `shutdown timed out`, releases the lock
  itself and exits 1, so the next start does not wait for the 90-second takeover. Only a
  `SIGKILL` leaves the lock behind.
- **One volume per project name.** `docker-compose.yml` fixes the project name to `get-me-there`, so every
  checkout on the same host uses the same volume, `get-me-there_gmt-data`, and the same database. A second
  clone started with plain `docker compose up` replaces the running container and migrates your real data. To
  try another checkout without touching it, give it its own project name, and so its own volume. Both
  projects publish `127.0.0.1:3000`, so stop your app first (`docker compose stop` in your own checkout),
  then in the other checkout run `docker compose -p gmt-trial up -d --build --wait --wait-timeout 120`.
  Afterwards remove it with `docker compose -p gmt-trial down -v`, which removes only the `gmt-trial`
  volume, and start your app again from your own checkout with
  `docker compose up -d --build --wait --wait-timeout 120`. Keep `--build`: both checkouts tag their image
  `get-me-there:local`, so without it your app would start on the trial checkout's code.
- **One user.** Run every command against the database as the app's user, which
  `docker compose exec app …` and `docker compose run app …` do by default (`node`). Never add
  `--user root` or `-u 0`: a check that only reads the database can still leave SQLite's `-wal`
  and `-shm` side files behind, and side files owned by root stop the app from opening its own
  database. On a development checkout, run `pnpm record:fixtures` and `pnpm dev` as the same OS
  user.
- A tool started from the command line while the app runs exits 75 and names the route to use
  instead.

## 10. Exit codes

Every command-line entry point (the app itself, `pnpm record:fixtures`, `pnpm smoke:live`,
`node scripts/backup.mjs`, `node scripts/check-backup.mjs`) and the `exitCode` of the
`/api/tools/*` routes use this one table. Codes `2` and `3` come only from the smoke test
(section 13):

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | a tool run failed (recording: a required call did not return its expected status; smoke test: a provider failed or a checklist line reads `FAIL`; the backup scripts: the built packages could not be loaded), or the app's shutdown timed out or failed |
| 2 | smoke test: no provider is configured; nothing was sent |
| 3 | smoke test: no error, but a provider had no price for the searched days (an Aviasales cache without a row for that month is common; try the other destination) |
| 64 | bad arguments (usage), or a recording of another route than the worked example without `--out DIR` outside the repository |
| 65 | a recording or smoke test refused for spend: with earlier tool runs in this database it would exceed the budget you gave (raise it only when you mean to spend more), or a provider's budget window has less room than the run needs |
| 70 | refused because `NODE_ENV=test`, or because fixture data is enabled |
| 73 | the data directory or `<data dir>/backups` is not writable, its file system cannot hold SQLite's WAL journal, the database lock cannot be read, or the pre-migration backup cannot be attempted |
| 74 | a backup failed (boot, `scripts/backup.mjs`) or is unusable (`scripts/check-backup.mjs`); at boot, migrations were not applied |
| 75 | the database lock is held by another running app or tool |
| 78 | bad configuration; the message names every variable to fix (for the smoke test, also a `DATABASE_PATH` that would put its fixtures inside the repository's recorded fixture tree) |

With `restart: unless-stopped`, an app that exits 73, 74, 75 or 78 restarts and fails the same
way until you fix the cause; `docker compose logs app` shows the message. The health check's
240-second start period covers the lock wait of section 9, the pre-migration backup, the
migrations and the first airport seeding.

## 11. Operating it

- **Start at boot.** `restart: unless-stopped` brings the app back after a reboot only if the
  Docker daemon itself starts at boot: `sudo systemctl enable docker` on Linux.
- **Health.** `docker compose ps` shows `healthy` while `GET /api/health` answers; that is a
  liveness check only, and Docker does not restart an unhealthy container. It reads the answer's
  `ok` flag, so a database that cannot answer `select 1` shows as `unhealthy`; `degraded` never
  does. Signed in,
  `curl -u operator http://127.0.0.1:3000/api/health` adds the detail: the database, each
  provider, and the scheduler's job count, next run, last run and `degraded` flag. A
  `degraded` app (scheduled jobs missing, a run stuck past `STUCK_AFTER_HOURS`) keeps serving;
  the status bar shows it and the log records it. Look at the detail when the newest run in
  History is older than your schedule says it should be.
- **Logs.** The app writes one JSON object a line; compose keeps 5 files of 10 MB. To follow
  one run: `docker compose logs --no-log-prefix app | jq -R 'fromjson? | select(.executionId == "<id>")'`.
- **Upgrade.** Back up first (section 6), then from your checkout: `git pull`,
  `docker compose up -d --build --wait --wait-timeout 120`. When the new version brings schema migrations, the app
  backs the database up again before applying them and logs `backup before N migration(s):
  <file>`. That file is the one a rollback needs and it sits on the volume, where newer backups
  prune it: once the log shows that line, run the cron command of section 6 once by hand (or
  `docker compose cp` that file out) so a copy exists off the volume.
- **Roll back a failed upgrade.** Check out the previous version, restore the backup the log
  named (section 6, Restore), and run `docker compose up -d --build --wait --wait-timeout 120`. An older version
  cannot use a database a newer one has migrated, so the restore is required.
- **Base image updates.** The `Dockerfile` pins `node:22-slim` by digest, so security fixes to
  Node and Debian arrive only when the pin moves. Once a month, run
  `docker buildx imagetools inspect node:22-slim`, put the new top-level digest in every `FROM`
  line, and upgrade as above.

## 12. Local development

```bash
pnpm install
mkdir -p data
NODE_ENV=development DATABASE_PATH="$PWD/data/dev.db" BIND_ADDRESS=127.0.0.1 pnpm dev
pnpm test
docker compose --profile dev up -d mailpit   # optional: catch alert email locally
```

`pnpm dev` runs the api and the web app with hot reload against `data/dev.db` (`data/` is in
`.gitignore`); it reads no `.env`, so it takes its settings from the shell. To send its mail to
Mailpit, export these in that shell, never in `.env`: the container would accept
them (loopback host), but there loopback is the container itself, so mail fails when it is sent:

```bash
export SMTP_HOST=127.0.0.1 SMTP_PORT=1025 SMTP_TLS=none SMTP_USER=dev SMTP_PASS=dev
export ALERT_EMAIL_TO=operator@example.com ALERT_EMAIL_FROM=get-me-there@example.com
```

Messages appear at <http://127.0.0.1:8025>. `SMTP_TLS=none` is accepted only for a loopback
host; the container never uses Mailpit.

## 13. The smoke test

The smoke test asks each configured provider for one small search and checks what comes back:
Travelpayouts one month of cached prices (a free call), SearchApi one date grid and one
itinerary search for its cheapest day pair (at most 4 credits). It prints the cheapest price a
seller confirmed (or, without one, the cheapest calendar price, labelled as such, with its
age), then a checklist. Run it after setup, after changing a key, and whenever prices look
wrong.

The smoke test applies none of a definition's constraints (stops, journey time, baggage): it
shows the cheapest offer whatever its route, and says for each itinerary price how long each
way takes and how many stops it makes (`out 19h 05m 2 stops, back 9h 30m nonstop`), so a long
connection is visible before you compare it with Google Flights.

Each database keeps its own count of the SearchApi credits tool runs have used (smoke tests and
fixture recordings): the container's volume one, a development checkout's `data/dev.db`
another. `budget` is the most that count may reach in the current budget window, this run
included. On the trial plan, first set `SEARCHAPI_TRIAL_USED` in `.env` to the credits the
SearchApi dashboard shows as used before this app counted any, so the app's window matches the
vendor's.

Start with a dry run. It sends nothing and shows the count so far, the plan and the window;
curl asks for the password:

```bash
curl -u operator -H 'Content-Type: application/json' -H 'X-Requested-With: get-me-there' \
  -X POST http://127.0.0.1:3000/api/tools/smoke -d '{"origin":"LHR","destination":"JFK","budget":8,"dryRun":true}'
```

Read the line that starts `SearchApi credits already ledgered to tool runs in this budget
window: N`. Choose `budget` as N plus 4, then send the same request without `"dryRun":true`.
When this run's 4 credits would go beyond `budget`, or the window has no room left, the smoke
test refuses with code 65 before sending anything. The answer's `exitCode` uses the table in
section 10, and `lines` holds the report. The app writes no fixtures for a smoke test it runs.

With the app stopped, on a development checkout, the same test runs from the command line
against that checkout's database:

```bash
pnpm smoke:live --origin LHR --destination JFK --budget 8 --dry-run
pnpm smoke:live --origin LHR --destination JFK --budget 8
```

It also writes what the vendors answered, dated, under `smoke/fixtures/recorded` beside the
database (`data/smoke/fixtures/recorded` for `data/dev.db`). Git ignores those files and they
stay on that machine, like every recorded vendor response (section 8).

Each checklist line reads `ok`, `FAIL`, `skip` or `look`:

- `one tile per provider`, `tiles read whole`: each provider was asked once, and every page
  and day of its answer was read.
- `ledger`: every answer the run received has its own row in the database's request log, with
  the same endpoint and status (retried attempts are counted separately), and the credits stayed
  inside this run's limit.
- `provenance`: each price shown carries the source kind, age limit and point of sale its
  provider's adapter declares, and was fetched during this run. The stored records are checked
  by the app's own tests.
- `airport pairs (metro rule)`: both providers were asked for the airports you named, never a
  city code.
- `9-day rectangle`, `step 1 = step 2`, `sellers`: SearchApi accepted the date grid the app
  uses, the return search priced the outbound it was asked about at the same price, and at
  least one offer was confirmed by a seller; an offer the last step did not confirm reads
  "price not confirmed by the final step".
- `open-jaw drop`, `age labels`, `separate tickets excluded` (`look`): compare these by eye with
  Google Flights and Aviasales for the same airports and dates; `open-jaw drop` lists the days
  where Travelpayouts rows that fly back to another airport were left out.

Codes `2` and `3` are not faults of the app: `2` means no provider key is set; `3` means a
provider had no price for those days.

## 14. The Camoufox provider (optional, off by default; macOS only)

### What it is and what it costs

The `camoufox` provider reads Google Flights itself, in Camoufox (a Firefox-based browser you have installed on your
Mac), started by a small worker process on the Mac. It is a continuity fallback for when SearchApi is
not available. It prices discovery cells only: one day pair a page, the cheapest round-trip price Google Flights lists,
labelled "Google Flights prices via Camoufox". Read its costs before you turn it on:

**Terms:** Read the provider's terms before enabling it; the operator is responsible for how it is used. **The operator's IP and account:** every page load comes from the operator's own
address (no proxies), so a block, CAPTCHA or wider restriction lands on that address, and through it on the operator's
other Google use from the same network; the worker's profile is never signed in, so the operator's account is never
used. **Brittleness:** Google changes the page without notice; a changed page reads as unrecognised and stops the
provider for an hour (never a silent zero), and the selectors and grammar must be re-dated against a new recording;
`camoufox-js` is marked experimental by its authors, and an upgrade of it, of `playwright-core` or of the Camoufox
binary is a re-verification. **Speed:** a page takes about 20–60 s (load, settle, read) plus the 30 s spacing, about
50–90 s in all, so 100 cells a run take about 1½–2½ hours. **Availability:** the provider runs only while the
operator's machine is on and the worker is running; otherwise its cells read skipped ("browser worker not reachable")
and every other provider runs. **Image size:** none in the app image, which is unchanged; Camoufox (several hundred
megabytes) and the worker's dependencies stay on the operator's Mac. **The worker key:** any process or container that
can reach the worker's address (Docker Desktop forwards `host.docker.internal` to the Mac's loopback for every
container) is stopped only by `CAMOUFOX_WORKER_KEY`. **Money:** none, against SearchApi's ~£32 a month.

Coverage, stated plainly: in `list` mode a page prices one day pair, so a run prices at most
`CAMOUFOX_EXECUTION_PAGE_CAP` day pairs and a month at most `CAMOUFOX_MONTHLY_PAGE_CAP`: with the defaults, 100 a run and
1,500 a month, against 2,184 day pairs for one worked-example airport pair (8,736 for its four pairs). The estimate says
how many cells a run will price and how many runs a full pass takes; the rest of the cells read skipped or not searched
in View D. Google's "no flights" line is verified (the 2026-10-18 recordings), so a day pair with no service reads as no data,
with no pause, as long as the line shows and the page has no result links. A page change that needs new recordings
sets the flag back, and empty routes then read as not searched again.

### How it behaves

- One page at a time, at least 30 seconds from the start of one page to the start of the next (never randomised).
- Its own signed-out browser profile, never shared and never seeded from any cookie file; service workers are blocked
  and every redirect is checked, so a page that leaves `https://www.google.com/travel/flights` stops at once.
- Your saved cookie choice (Reject all) is applied before every page and checked by value after it; a consent page, or a
  changed or missing choice, stops it.
- The worker stops and cools down whenever a page is not a recognised results page: a challenge or verification page,
  a sign-in page, a consent page, or anything unrecognised. It pauses 48 hours after a challenge, sign-in or consent
  page and 1 hour after a page it does not recognise. It never solves or clicks through a challenge, and nothing
  retries it.
- The camofox-browser server is not used and need not run.

### Set it up (macOS)

1. Create the worker's data directory, private to you:
   `mkdir -p -m 700 ~/.local/state/get-me-there/camoufox`
2. Run `pnpm install` in a checkout of this repository. The worker runs from source; repeat it after every `git pull`.
   The worker launches the Camoufox bundle already installed under `~/Library/Caches/camoufox/browsers/official/`
   (`<version>-<build>-<id>/`, the layout the camofox-browser installer leaves; the pinned build is `152.0.4-beta.28`).
   It creates the `Camoufox.app` link and the top-level `version.json` beside it itself, and refuses anything that
   disagrees rather than rewriting it. It never downloads a browser: camoufox-js's own `fetch` unpacks into a different,
   flat layout, which the worker refuses. `pnpm --filter @gmt/camoufox-worker status` names the build it launched. macOS
   may purge `~/Library/Caches`: if the bundle is gone, reinstall it with the same installer, then run `status`.
3. Capture your cookie choice. In an ordinary private browser window open `https://www.google.com/travel/flights`, click
   **Reject all**, then open the cookie view (developer tools, Storage or Application, cookies for
   `https://www.google.com`). Run `pnpm --filter @gmt/camoufox-worker capture-socs` and paste the `SOCS` cookie's value,
   expiry, Secure and SameSite when asked. It stamps the time and writes the file 0600; capture again within 13 months.
4. Create `~/.local/state/get-me-there/camoufox/worker.env` in an editor (never with `echo`) and make it private with
   `chmod 600 ~/.local/state/get-me-there/camoufox/worker.env`. It holds `CAMOUFOX_WORKER_KEY`, at least 32 random
   characters: generate them with `openssl rand -hex 24 > ~/.local/state/get-me-there/camoufox/key.tmp`, paste them from
   that file into `worker.env`, then delete `key.tmp`. Add `CAMOUFOX_BINARY_BUILD` only if your Camoufox build is not the
   default one. That file is the only place the key lives on the Mac.
5. Start it: `pnpm --filter @gmt/camoufox-worker start` to try it, from a shell that has not loaded the app's
   `CAMOUFOX_*` lines (the worker refuses an inherited `CAMOUFOX_*` or `POINT_OF_SALE` that differs from `worker.env`,
   and any `DEBUG`). To keep it running, install the launchd agent: copy
   `apps/camoufox-worker/launchd/local.get-me-there.camoufox-worker.plist.example` to
   `~/Library/LaunchAgents/local.get-me-there.camoufox-worker.plist`, set your checkout path, your home and a `PATH` that finds
   `node` and `pnpm` in it (it starts the worker with an emptied environment), and run
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.get-me-there.camoufox-worker.plist`. A start check
   that fails exits 78 and the agent does not restart it faster than once a minute; logs go to
   `~/Library/Logs/get-me-there/`.

The search-form check is mandatory: the worker refuses to start while `FORM_VERIFIED` is false. The 2026-10-18
recordings set it, with the results, Cheapest and no-flights flags. A page change that needs new recordings sets them
back. Record with the default data directory (never a `CAMOUFOX_DATA_DIR` override): the
lock, the spacing and the cool-down are kept there, so a recording and a running worker can never load pages at once.

Recordings are written under `apps/camoufox-worker/fixtures/recorded/` in the checkout or worktree that made them, and
are never committed, so removing that worktree deletes them. Back them up after each recording session with
`pnpm --filter @gmt/camoufox-worker recordings:backup`: it copies them (never a `.gitkeep`) into a dated
`camoufox-<YYYY-MM-DD>` directory in your private data store outside the checkout, which it prints, with directories 0700
and files 0600, and adds to a backup already made that day. In a fresh checkout, `pnpm --filter @gmt/camoufox-worker recordings:restore` copies the
latest backup back (or `recordings:restore 2026-10-18` for a named day); it refuses a tree that already holds a
recording.

`record --graph-explore` (with the same `--origin`, `--destination`, `--depart` and `--return`) settles the results page
as the other kinds do, clicks its one "Price graph" button and writes what appeared to
`fixtures/recorded/graph-explore/<date>/<n>.json`: the region's accessibility snapshot, the names and roles of its
controls, what was clicked, the cookie read-back and the timings. It is an exploration for building a later mode; the
provider never clicks the graph and nothing reads these files yet.

### Point the app at it

- **Docker:** add `CAMOUFOX_ENABLED=true` and the same `CAMOUFOX_WORKER_KEY=` line to `.env` with an editor, and leave
  `CAMOUFOX_WORKER_URL` unset: the compose default, `http://host.docker.internal:8090`, reaches the worker through
  Docker Desktop. Then `docker compose up -d`.
- **`pnpm dev`:** keep the two lines and `CAMOUFOX_WORKER_URL=http://127.0.0.1:8090` in a 0600 file such as
  `~/.config/get-me-there/dev-camoufox.env`, and load it into the shell that runs `pnpm dev` with
  `set -a; . ~/.config/get-me-there/dev-camoufox.env; set +a`, so the key is never typed or exported by hand and never
  reaches your shell history. Never put that URL in `.env`, where it would break the container.

Keep `CAMOUFOX_COOLDOWN_HOURS` and `CAMOUFOX_PAGE_TIMEOUT_SECONDS` equal on both sides (`worker.env` and the app's); the
smoke test flags a mismatch.

### Grid mode (optional)

In `list` mode a page prices one day pair. In `grid` mode the worker opens the results page's "Price graph", then its
"Dates" tab, and reads Google's 7 × 7 date grid: up to 49 day pairs a view. Each scroll moves the grid one day and
shows 7 new day pairs; a new page opens any 7 × 7 block directly. To turn it on, add `CAMOUFOX_MODE=grid` to both
`worker.env` and the app's settings, and restart both. The worker serves grid pages only while its selectors module
marks the grid verified (the recordings of 2026-10-18); otherwise the app skips the provider ("grid mode not
verified on the worker").

- **Prices.** Google's own date grid, labelled "Google Flights date grid via Camoufox": whole pounds, an assumed age
  of up to 24 hours (Google does not state it), the return date read from the grid cell. Google's "cheapest price" and
  "low price" marks are shown as Google's, for the prices in that view only, never as this app's own minimum.
- **Caps.** Every page still counts one page against `CAMOUFOX_EXECUTION_PAGE_CAP` and `CAMOUFOX_MONTHLY_PAGE_CAP`.
  Scrolls have their own caps: `CAMOUFOX_EXECUTION_SCROLL_CAP` (default 600) and `CAMOUFOX_MONTHLY_SCROLL_CAP`
  (default 6,000), at most `CAMOUFOX_GRID_SCROLL_CAP` (default 30) a page, at least
  `CAMOUFOX_GRID_SCROLL_SPACING_SECONDS` (default 5, never randomised) between scroll clicks. Keep the grid settings
  equal in `worker.env` and the app's settings: the worker reports its scroll cap and spacing, and the app skips the
  provider, naming the setting, while they differ. A page asks for no more scrolls than the run's and the month's
  scroll caps leave; with none left it still reads its first block, and the blocks it did not reach stay for the next
  run.
- **Speed and coverage.** A page opens a block in about 30 s and a scroll takes about 9.3 s (measured 2026-10-18), so
  a new page is the quicker way to a new block, and the planner opens pages until the page cap binds, then scrolls.
  For the worked example's four airport pairs (312 blocks of 7 × 7, of which the 8,736 day pairs in the 10–21-night
  band are stored), the run's estimate with the defaults is 100 pages and 588 scrolls, about 2.4 hours, reading 5,152 of
  the 8,736 day pairs, and a full pass takes 3 runs; with `CAMOUFOX_EXECUTION_PAGE_CAP=312` it is one run of 312 pages
  and no scrolls, about 2.6 hours. A page with its full 30 scrolls takes about 5 minutes; at the maximums (60 scrolls,
  30 s spacing) about 30 minutes, and the estimate says when a run would pass `STUCK_AFTER_HOURS`.
- **What a page does when something is off.** A challenge, sign-in, consent or account page on any poll stops it with
  its cool-down, and nothing from that page is kept. A scroll whose view never changes ends the page with the views
  already read. A view whose dates differ from the plan (near today, or at the end of the sale window) is kept and
  ends the page. A view the worker cannot read as the grid, or whose cells no longer match the dated grammar, stops it
  for an hour. Past the sale window Google shows its no-flights page: the day pairs on or after the page's first pair
  on both dates read as no data, and the others as issues. Day pairs the grid could not show read as issues on the
  cell (resumable), never as prices. A 0-night stay opens its first block a day later and scrolls up once to it.

### Choose it

Add "Google Flights prices via Camoufox" to a definition's discovery providers. New definitions never include it.

### Check it

`pnpm --filter @gmt/camoufox-worker status` reads the key from `worker.env` itself and prints the worker's current status:
the cool-down, the account-cookie check, the verification flags and the versions. `lsof -nP -iTCP:8090 -sTCP:LISTEN`
shows it listening on `127.0.0.1` only. To see which navigation a stopped page refused, add `CAMOUFOX_LOG_DEBUG=true` to
`worker.env` and restart the worker: each refusal then also logs its path (never its query) in the agent's error log.

### Turn it off or recover

- Set `CAMOUFOX_ENABLED=false` and restart the app.
- Stop the worker: `launchctl bootout gui/$(id -u)/local.get-me-there.camoufox-worker`. A page in flight finishes
  before the worker exits.
- After a signed-in refusal: `pnpm --filter @gmt/camoufox-worker clear-signed-in` (it wipes the profile first).
- Deleting the cool-down record ends a pause early, which defeats its purpose.

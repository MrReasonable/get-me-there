# Setup

There are two ways to run get-me-there, and each section below says which it applies to:

- **Native (the default on your own Mac or Linux machine):** `pnpm gmt setup` installs the app
  as a user service. Section 0 is the whole path.
- **The container (a VPS, or Docker Desktop on a Mac):** one container with a named volume.
  Sections 1 to 13 describe it; [`local-quickstart.md`](local-quickstart.md) and the root
  `Start.command` are the Docker Desktop shortcut on a Mac.

Everything below uses the worked example London → New York; put your own airports in the
Definitions form, never in a file of this repository.

## 0. Quick start (macOS and Linux)

*Applies to: the native path.* On a VPS, use the container path below (sections 1 to 13); for
Docker Desktop on a Mac, see [`local-quickstart.md`](local-quickstart.md) and `Start.command`.

You need Node 22.18 or later, git, and on Linux a systemd user session. On a clean machine, get
Node from the installer at nodejs.org or a package manager: on macOS `brew install node@22`
(Homebrew), on Linux your distribution's `nodejs` package or NodeSource's. Node 25 and later no
longer include corepack, so there run `npm install --global corepack` first. Then, in a terminal
on the machine itself:

```bash
git clone https://github.com/MrReasonable/get-me-there.git
cd get-me-there
corepack enable
pnpm install
pnpm gmt setup
```

Where Node's own directory is not writable (a system package), run
`corepack enable --install-directory ~/.local/bin` instead and add `~/.local/bin` to `PATH`. On a
Mac, keep the clone out of Desktop, Documents, Downloads and iCloud Drive: macOS does not let a
background service read those folders, so setup refuses there. Setup checks everything it needs
before it writes anything, names the fix for anything missing, and builds the app itself.

### The questions

Pressing Enter at every question gives a running app with no price source.

| # | Question | Default (Enter) | What it means |
|---|---|---|---|
| 1 | Port | 3000, or the next free one | The app listens on this machine only (127.0.0.1). |
| 2 | Time zone for schedules | the machine’s | Scheduled searches fire in this zone. |
| 3 | Fare market | GB | The country whose fares the searches ask for, as two letters (GB, US, …). It can change which fares appear; prices are always shown in pounds in this build. |
| 4 | Travelpayouts token | skip | Free prices cached from what other travellers recently searched on Aviasales, typically hours to days old; your stay and date limits are not applied, so check a fare on the airline’s site before you rely on it. Needs a free Travelpayouts account: if you have none, register at https://www.travelpayouts.com/, then copy the token from your Profile’s API token section (help: https://support.travelpayouts.com/hc/en-us/articles/203956083). |
| 5 | SearchApi | off | Google Flights results through SearchApi. The free trial is a one-off 100 searches for `pnpm gmt smoke` only: scheduled searches never use it. The $40 a month plan lets scheduled searches spend up to its 10,000 searches a month. |
| 6 | Email alerts | skip | Send alerts and notices by email. |
| 7 | Keep running after you log out (Linux) | no | Without it, the app stops when you log out of every session; setup runs loginctl enable-linger for you. |

Secrets (tokens, keys, the SMTP password) are typed hidden; setup generates the app's password
itself. For the SearchApi free trial, setup also asks how many of the trial's 100 searches are
already used (100 minus what your SearchApi dashboard says is left). For email it asks the SMTP
host, port, TLS, user, password, and the to and from addresses. Row 7 runs
`loginctl enable-linger <you>` without `sudo`; if that is refused it prints the `sudo` line for
you to run, and setup never runs `sudo` itself. `pnpm gmt setup --reconfigure linger` changes it
later.

Row 8 is the browser provider, offered after the app is running and only where this machine has
verified recordings (section 14: its costs come first, and it stays off unless you say yes). One
more question is asked by `pnpm gmt setup --reconfigure browser` only: "Browser provider after an interruption". If a run is interrupted (for example the laptop sleeps), should the browser part finish when it resumes, even outside the scheduled hours? [no]

When no price source was chosen and the terminal is interactive, setup asks once, before it
changes anything: "Paste a token now? (Enter to finish without one)". A pasted token is the
Travelpayouts token, as if row 4 had been answered. The SearchApi free trial is not a price
source for searches: it serves `pnpm gmt smoke` only.

### Where things are kept

| What | Where |
|---|---|
| Settings | `~/.config/get-me-there/app.env` (the directory 0700, the file 0600) |
| Database and backups | `~/.local/share/get-me-there/` (0700: `get-me-there.db`, `backups/`) |
| The browser worker's state | `~/.local/state/get-me-there/camoufox/` |
| Logs | macOS: `~/Library/Logs/get-me-there/`; Linux: the user journal |
| Services | macOS: `~/Library/LaunchAgents/local.get-me-there.app.plist` and `local.get-me-there.backup.plist`; Linux: `~/.config/systemd/user/get-me-there-app.service`, `get-me-there-backup.service` and `.timer` |

On Linux, `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_STATE_HOME` move the first two when they
are absolute paths; the browser worker's directory never moves. The services run the Node
binary setup ran under (the stable path on your `PATH`, such as Homebrew's, rather than a
versioned one), with only `PATH` and `HOME` in their environment, so nothing else in your shell
changes a setting; a Node inside a temporary or version-manager shim directory is refused
(setup names a stable one).

### What keeps it running

On macOS the app runs while you are logged in and starts again when you log in; a Mac that must
run unattended needs automatic login. `pnpm gmt stop` lasts until the next login or restart. On
Linux it runs while you are logged in, and after you log out only with linger (row 7). After
upgrading Node by any route other than the package manager's own link, run `pnpm gmt setup` again
so the services point at the new binary; `pnpm gmt status` flags a missing one.

### When setup finishes

With no price source, the closing screen says so first:

> No price source is set up yet, so searches will find nothing. The no-cost source is Travelpayouts, which needs a free account: register at https://www.travelpayouts.com/, then copy the token from your Profile’s API token section (help: https://support.travelpayouts.com/hc/en-us/articles/203956083) and run `pnpm gmt setup --reconfigure travelpayouts`.

Then it gives the address (`http://127.0.0.1:3000`), the user name (`operator`), and where the
password is: in `~/.config/get-me-there/app.env`. Show it with `pnpm gmt password`, which
prints it to the terminal only. If scrollback or a shared screen may have kept it,
`pnpm gmt setup --reconfigure password` replaces it. It names the next step: open the app,
choose Definitions and add a search with your airports and dates (its Coverage check shows what
the price sources hold before you save it). Nothing runs on a schedule until you give a search
one. Setup offers to open the browser.

Scheduled searches run while the machine is awake; a missed one is caught up once, without the
browser provider. The native service speaks plain HTTP on `127.0.0.1`: only if you want to reach
it from another device, use an `ssh` tunnel (`ssh -L 3000:127.0.0.1:3000 <this machine>`), or
section 3 for Tailscale and TLS.

### The commands

```bash
pnpm gmt setup                          # install, or re-check an install
pnpm gmt setup --dry-run                # print the plan with the real launchctl or systemctl commands
pnpm gmt setup --reconfigure email      # one group again: port, timezone, email, travelpayouts, searchapi, browser, password, linger
pnpm gmt status                         # the services, the settings files, the newest backup, the app's own report, anything to fix
pnpm gmt status --only worker           # the app's report for one area; --json prints it as JSON
pnpm gmt start
pnpm gmt stop                           # refuses while a search runs, unless --wait or --force
pnpm gmt restart
pnpm gmt logs
pnpm gmt backup                         # a backup now (the daily job's, run once)
pnpm gmt restore <file>                 # see "Restore (native)" below
pnpm gmt password
pnpm gmt smoke --from LHR --to JFK      # section 13; it spends real calls
pnpm gmt update                         # fast-forward only to origin/main, with a backup first
pnpm gmt update --dry-run               # print the update's plan and change nothing
pnpm gmt uninstall                      # removes the services; keeps settings, data and state
pnpm gmt uninstall --purge              # also deletes those three directories, after you type purge
pnpm gmt browser install                # the browser provider's Camoufox (section 14), whatever runs the app
pnpm gmt browser counts                 # rewrite the browser worker's monthly counts (section 14)
pnpm gmt consent                        # capture your consent choice: a window opens, you click Reject all (section 14)
pnpm gmt consent export                 # the same on a desktop, printed as one line for a machine with no display
pnpm gmt consent import                 # on that machine: reads the line from standard input (a pipe)
pnpm gmt consent check                  # the stored choice's mark and expiry; loads no page
```

On Linux, uninstall (with or without `--purge`) offers to turn off the linger setup turned on, or
prints the `loginctl disable-linger` line when it cannot ask. `--purge` names anything it leaves,
such as the browser worker's directory when `XDG_STATE_HOME` moved the state elsewhere.

Re-running `pnpm gmt setup` changes nothing that is already right: a settings file that differs
from what setup would write is reported, never overwritten, and `--reconfigure <group>` is the
way to change one group's lines. Lines you add to `app.env` under other names are kept. Setup
calls no vendor. Every command that stops or restarts the app (`stop`, `restart`, `update`,
`--reconfigure`, the imports) first asks the app whether a search is running, refuses while one
is (or when the app cannot say) unless `--wait` or `--force`, and with `--force` first says what
the interruption does.

`pnpm gmt smoke` spends: before it sends anything it prints the route's worst case per
provider from the app (with today's settings, up to 4 SearchApi credits and one browser page)
and the SearchApi credits tool runs have already used in this window, refuses when the SearchApi
trial has fewer credits left, and asks you to type `yes` for the running total. In scripts `--yes`
skips the question, and once earlier tool runs have used credits in the window it also needs
`--accept-total`. Lowercase airport codes are accepted.

`pnpm gmt update` refuses a checkout with local changes or not on `main`, fetches before it
stops anything, and refuses while a search is running (naming it and its estimated finish)
unless `--wait` or `--force`. Where the browser provider is set up, it also downloads and checks
the next commit's Camoufox before it stops anything (section 14). It then stops the app, backs up
into `backups/update` (with a `.commit` file naming the commit it was taken at), merges,
installs, builds, switches the browser to the new Camoufox, restarts, waits for health and shows
the status. If a step fails it prints the commit it started from, the backup (or why there is
none), and the ways back; running `pnpm gmt update` again carries on from the failed step. A
failed browser step never keeps the app down: the app starts without the browser worker, the
update exits 1, and `pnpm gmt browser install` retries the browser.

### Moving from Docker or from a checkout

Only one app may keep the usage ledger, or caps would count twice. If this machine has the
Docker install (a compose project `get-me-there` or its volume), setup refuses until you choose:

```bash
pnpm gmt setup --import-docker                   # move the Docker database here
pnpm gmt setup --ignore-docker                   # start fresh here; stops the Docker app and marks its volume moved
pnpm gmt setup --import-db data/get-me-there.db  # move a checkout's database (its app must be stopped)
```

`--import-docker` refuses while the container is running a search (`--wait` waits for it, and
it asks again just before it stops the container), stops the container, backs up from the
stopped volume, copies the backup out, restores and checks it here, and only then writes
`MOVED-TO-NATIVE` beside the old database. It carries your Docker `.env` settings across, one
group at a time when you are asked: the price sources with their caps, email, the time zone,
the market, and the spending caps and run settings; `SEARCHAPI_TRIAL_USED` goes with the
SearchApi key. It offers `docker compose down` (the volume is kept).

`--ignore-docker` does not import: it stops the Docker app and writes the same marker, so the
Docker app refuses to start on that volume, and its ledger's month stops counting toward the
caps here (check the vendors' dashboards). Never start the compose stack on a marked volume:
with the marker it exits and restarts in a loop. To use the container again, remove the marker
first: `docker compose run --rm --no-deps --entrypoint rm app /data/MOVED-TO-NATIVE`. Over an
existing native database every import refuses unless `--replace-database`, which backs the
native one up first; the replaced ledger's calls then stop counting toward the caps.

### Backups

A daily job at 03:30 writes a backup into `~/.local/share/get-me-there/backups/daily` and keeps
14; setup takes the first one before it finishes, and `pnpm gmt backup` takes one by hand.
`pnpm gmt update` keeps 5 in `backups/update`. List them with
`ls -l ~/.local/share/get-me-there/backups/*/`. These backups sit on the same disk as the
database: they protect against a bad update or a deletion, not against losing the disk, so copy
the folder elsewhere (Time Machine includes it).

### Logs

On macOS the logs go to `~/Library/Logs/get-me-there/`, and `pnpm gmt status` warns past
100 MB. To rotate them, add a `newsyslog` rule (the user and path are yours):

```bash
echo '/Users/<you>/Library/Logs/get-me-there/*.log <you>:staff 640 5 10240 * GJN' | sudo tee /etc/newsyslog.d/get-me-there.conf
```

On Linux the logs are in the user journal (`pnpm gmt logs`). Setup notes when the journal is not
persistent (`/var/log/journal` absent), which loses them at a reboot.

### Restore (native)

A backup goes with the code that wrote it: an update's backup names its commit in the
`.commit` file beside it; a daily backup was taken on whatever code was running that day. When
the code has not changed since the backup, the first four steps below are not needed.

```bash
pnpm gmt stop
git checkout <commit>
pnpm install --frozen-lockfile
pnpm build
pnpm gmt restore <backup>
pnpm gmt start
```

`pnpm gmt restore` refuses a file that fails `PRAGMA integrity_check`, keeps the current
database, with its `-wal` and `-shm`, as `get-me-there.db.before-restore-<time>` (never over an
earlier one), and copies the backup into place, 0600. A restored ledger lacks any call made
after its backup, so check each vendor's dashboard and set `SEARCHAPI_TRIAL_USED` (trial) or
`SEARCHAPI_MONTHLY_CALL_CAP` ($40 plan) to match. Starting the app then resumes any run the
backup held as running and catches up a missed firing once per scheduled search (set
`AUTO_RESUME=false` in `app.env` first if you do not want that). The checkout is then on a
detached commit: run `git switch main` before the next `pnpm gmt update` (`pnpm gmt status`
reports it).

## 1. Authentication first

*Applies to: the container path. A native install generates its basic auth (section 0).*

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

*Applies to: the container path. Natively, this is row 4 of section 0, or `pnpm gmt setup --reconfigure travelpayouts`.*

Get a free Travelpayouts token (Travelpayouts account → API token) and add it:

```dotenv
TRAVELPAYOUTS_TOKEN=your-travelpayouts-token
APP_BASIC_AUTH_USER=operator
APP_BASIC_AUTH_PASS=CHANGE-ME
```

That is the whole `.env` for £0. Then:

```bash
docker compose up -d --build --wait --wait-timeout 240
docker compose ps                     # "healthy"
```

If it has not reported healthy after 4 minutes, run docker compose logs app: a configuration
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

*Applies to both paths. Natively, the lines go in `~/.config/get-me-there/app.env`, then `pnpm gmt restart`.*

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

*Applies to the container path; natively, `pnpm gmt setup --reconfigure email` asks the same settings.*

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

*Applies to both paths.*

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

*Applies to the container path; the native backups and restore are in section 0.*

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

4. Start and check: `docker compose up -d --wait --wait-timeout 240`, then `curl -fsS http://127.0.0.1:3000/api/health`.
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

*Applies to both paths.*

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

*Applies to a development checkout, not to either install.*

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

*Applies to both paths; moving between them is in section 0.*

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
  then in the other checkout run `docker compose -p gmt-trial up -d --build --wait --wait-timeout 240`.
  Afterwards remove it with `docker compose -p gmt-trial down -v`, which removes only the `gmt-trial`
  volume, and start your app again from your own checkout with
  `docker compose up -d --build --wait --wait-timeout 240`. Keep `--build`: both checkouts tag their image
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

*Applies to both paths.*

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

*Applies to the container path, except the first part below, which applies to both; the native commands are in
section 0.*

### Status first

The app reports on itself. Open the **Status** view (the nav's last link), or run `pnpm gmt status` (add
`--only <area>` for one area, `--json` for the report as the app sent it). Both show the same checks, worst first,
each with a plain summary and what to do about it; in a native install the fix is a `pnpm gmt` command with a
copy button. Reading it never spends a call, never waits on a vendor and never loads a page. The status bar on every
view links to it: "Status: 2 failing" when any check fails, the quieter "Status: consent to check" when something is
worth a look, nothing when nothing needs a look, and "Status: stale, checked 3 min ago" or "Status: app not answering" when the
report cannot be refreshed. `pnpm gmt status` exits 1 when any check fails or the app does not answer; with the app
down it still prints the local facts (with `--json`, a JSON object whose `appAnswering` is false) and says what to try.
`pnpm gmt update` prints the report at its end but exits on its own steps and the app's health, not on an unrelated
failing check.

- **App, database, backups.** The version, how long it has run and whether it is bound to this machine only with a
  password on; the database answering and its size; the newest daily backup (`warn` after 36 hours, `fail` when there
  is none and the app is older than that; a new install shows "first daily backup due 03:30" until the first one
  exists). In the container path the backups card says they are not visible from there: check your host's backup job
  (section 6).
- **Schedule.** The jobs registered, the last and next run, a run caught up after a sleep or a restart (a note, not a
  problem), and a warning when two searches that use the browser provider fire at the same time: stagger them so
  neither waits for the other's browser pages.
- **Data.** One card per search: its last finished run's cells in the six buckets (priced, no fares, no cached data,
  error, skipped, not searched, out of the run's cells), "(n reused from earlier runs)" when a run reused earlier
  outcomes, and both ends of the prices' ages ("newest price 1h old, oldest 6d old"; "age unknown" where a vendor gives
  no bound). It warns when errors, skipped and not searched cells are over a fifth of the cells, when the oldest price
  is past its stale threshold, when there is no price yet, or when the last firing was skipped (with the stored reason).
  A catch-up loads no browser pages, so a search that only the browser provider can run warns: keep the machine awake
  at the scheduled time, or move the schedule.
- **Providers.** One card per price source with its last successful call and its use against its cap (the Providers
  view's wording, linked), and **price sources**, which warns when no usable source is set up.
- **Browser worker and consent.** Whether the worker answers, its monthly pages and scrolls against the caps, any
  cool-down, a setting that differs between the app and the worker (named, never its value), and the app's browser
  window: "browser pages: only inside a run's window" or "also when a run resumes". The consent card gives the
  record's expiry and warns for its last 30 days. While it warns or fails (not while it is off or ok) and the browser
  provider is on, the app emails you at most once a London day (a plain notice from the app, with no separate reminder
  service). A check that cannot be made, because the worker is down, sends nothing: the worker card says that.
- **Email.** Configured or not, and the newest send of any kind since the app started (an alert, a notice or a test);
  the card fails when that send failed. **Send test** (or the offer at the end of a full `pnpm gmt setup` and of
  `pnpm gmt setup --reconfigure email`) sends one fixed message; tests have their own limit of one a minute and never
  use up the hourly alert limit.
- **Off.** A check that is not set up, is waiting for a verified browser build, or belongs to a disabled search folds
  into one line that says why ("not set up: SearchApi"; "awaiting verification for this build: browser provider";
  "disabled: <search name>").
- **Version.** The app check shows the build. A checkout shows its git short commit id; a container image has no git, so
  compose passes `APP_VERSION` as a build argument (`Start.command` sets it to `git rev-parse --short HEAD`; for your
  own `docker compose` runs: `APP_VERSION=$(git rev-parse --short HEAD) docker compose up -d --build`); without it the
  card says `unknown`.

`curl -u operator http://127.0.0.1:3000/api/health` stays for scripts and Docker.

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
  `docker compose up -d --build --wait --wait-timeout 240`. When the new version brings schema migrations, the app
  backs the database up again before applying them and logs `backup before N migration(s):
  <file>`. That file is the one a rollback needs and it sits on the volume, where newer backups
  prune it: once the log shows that line, run the cron command of section 6 once by hand (or
  `docker compose cp` that file out) so a copy exists off the volume.
- **Roll back a failed upgrade.** Check out the previous version, restore the backup the log
  named (section 6, Restore), and run `docker compose up -d --build --wait --wait-timeout 240`. An older version
  cannot use a database a newer one has migrated, so the restore is required.
- **Base image updates.** The `Dockerfile` pins `node:22-slim` by digest, so security fixes to
  Node and Debian arrive only when the pin moves. Once a month, run
  `docker buildx imagetools inspect node:22-slim`, put the new top-level digest in every `FROM`
  line, and upgrade as above.

## 12. Local development

*Applies to a development checkout, not to either install.*

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

*Applies to both paths; on a native install, run it with `pnpm gmt smoke --from LHR --to JFK` (section 0).*

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

## 14. The Camoufox provider (optional, off by default; macOS and Linux)

### What it is and what it costs

The `camoufox` provider reads Google Flights itself, in Camoufox (a Firefox-based browser that `pnpm gmt setup` installs on
this machine), started by a small worker process on the same machine. It is a continuity fallback for when SearchApi is
not available. It prices discovery cells only: one day pair a page, the cheapest round-trip price Google Flights lists,
labelled "Google Flights prices via Camoufox". Read its costs before you turn it on:

**Terms:** Read the provider's terms before enabling it; the operator is responsible for how it is used. **The operator's IP and account:** every page load comes from the operator's own
address (no proxies), so a block, CAPTCHA or wider restriction lands on that address, and through it on the operator's
other Google use from the same network; the worker's profile is never signed in, so the operator's account is never
used. **Brittleness:** Google changes the page without notice; a changed page reads as unrecognised and stops the
provider for an hour (never a silent zero), and the selectors and grammar must be re-dated against a new recording;
`camoufox-js` is marked experimental by its authors, and an upgrade of it, of `playwright-core` or of the Camoufox
binary is a re-verification. **Speed:** a page takes about 20–60 s (load, settle, read) plus the page spacing
(`CAMOUFOX_MIN_SPACING_SECONDS`, 30 s by default), so at the default about 50–90 s in all and 100 cells a run take
about 1½–2½ hours; a smaller spacing shortens the run, never the page. **Availability:** the provider runs only while
the machine running the worker is on and the worker is running; otherwise its cells read skipped ("browser worker not
reachable") and every other provider runs. **Image size:** none in the app image, which is unchanged; Camoufox (a
313 MB download on Apple silicon or 320 MB on an Intel Mac, about 670 MB unpacked; 654 MB on arm64 Linux or 663 MB on
x86_64 Linux, about 1.25 GB unpacked) and the worker's dependencies stay on the machine running the worker.
**The worker key:** any process or container that can reach the worker's address (on macOS,
Docker Desktop forwards `host.docker.internal` to the Mac's loopback for every container) is stopped only by
`CAMOUFOX_WORKER_KEY`. **Money:** none, against SearchApi's ~£32 a month.

Coverage, stated plainly: in `list` mode a page prices one day pair, so a run prices at most
`CAMOUFOX_EXECUTION_PAGE_CAP` day pairs and a month at most `CAMOUFOX_MONTHLY_PAGE_CAP`: with the defaults, 100 a run and
1,500 a month, against 2,184 day pairs for one worked-example airport pair (8,736 for its four pairs). The estimate says
how many cells a run will price and how many runs a full pass takes; the rest of the cells read skipped or not searched
in View D. Google's "no flights" line is verified (the 2026-10-18 recordings), so a day pair with no service reads as no data,
with no pause, as long as the line shows and the page has no result links. A page change that needs new recordings
sets the flag back, and empty routes then read as not searched again.

### How it behaves

- One page at a time, at least `CAMOUFOX_MIN_SPACING_SECONDS` (default 30 seconds, 0 to 600) from the start of one page to the start of the next (never randomised). A value of 0 means no pause: pages go back to back, from your own address, still one at a time. Keep it equal in `worker.env` and the app's settings.
- Its own signed-out browser profile, never shared and never seeded from any cookie file; service workers are blocked
  and every redirect is checked, so a page that leaves `https://www.google.com/travel/flights` stops at once.
- Your saved cookie choice (Reject all) is applied before every page and checked by value after it; a consent page, or a
  changed or missing choice, stops it.
- The worker stops and cools down whenever a page is not a recognised results page: a challenge or verification page,
  a sign-in page, a consent page, or anything unrecognised. It pauses 48 hours after a challenge, sign-in or consent
  page and 1 hour after a page it does not recognise. It never solves or clicks through a challenge, and nothing
  retries it.
- The camofox-browser server is not used and need not run.

### Set it up

`pnpm gmt setup` sets it up as one row of the wizard (row 8), and `pnpm gmt setup --reconfigure browser` resumes or
changes it later.

- **When it is offered.** Only where this machine's `<os>-<arch>` (`darwin-arm64`, `darwin-x64`, `linux-arm64`,
  `linux-x64`) has verified recordings for its pinned Camoufox build. Elsewhere setup says once "The browser provider is
  not available on this machine yet (no recordings for <os>-<arch>); SearchApi and Travelpayouts work", downloads
  nothing and leaves `CAMOUFOX_ENABLED` unset; a later `pnpm gmt setup` or `pnpm gmt update` offers it once
  recordings land. Today `darwin-arm64` has them.
- **Its costs first.** Setup prints the costs above before it asks, on every machine. On a machine with no display it
  adds: "Page loads will come from this server's address, not a home connection. A datacentre address is more likely to
  be refused or shown a verification page, and each one pauses the provider for 48 hours; any restriction applies to
  that address. If that is not acceptable, leave the provider off, or run the app on a machine at home." and turns it on
  only after you type `yes` (in an answers file, `"browser": { "window": "scheduled", "enabled": true,
  "acceptServerAddress": true }`). `--non-interactive` without those fields leaves it off.
- **The order of its steps.** The consent method is explained; then the install, the same steps as
  `pnpm gmt browser install` (below): anything an interrupted attempt left under the install root is removed, a
  free-space check against the download plus its unpacked size (the sizes above), `unzip`, the download of the pinned
  asset (setup says its size first, then again before it unpacks) from the project's GitHub release over HTTPS (redirects followed only to GitHub's
  release-asset hosts), its digest checked while it streams and again before unpacking, the archive's entries listed
  and refused if any is absolute or leaves its directory, the unpack into a private temporary directory beside the
  target, and one rename into `~/.local/share/get-me-there/camoufox/browsers/official/<build>-<8 hex>/`. Then
  `worker.env` (0600, in `~/.local/state/get-me-there/camoufox/`, 0700) with a newly generated
  `CAMOUFOX_WORKER_KEY` (48 hex characters), the same key and `CAMOUFOX_WORKER_URL` in `app.env` (the worker's own
  port, `CAMOUFOX_WORKER_PORT` in `worker.env`, 8090 when unset), and the settings the two sides share copied from
  `app.env`; both files are read back before they are written. Then, when setup asks you questions on a machine with a
  display, the consent capture as its own step (below): a window opens and you click Reject all. Then the worker's own
  start check (`run.ts check --json`): only once it finds your consent choice does `app.env` gain `CAMOUFOX_ENABLED=true` and the worker service get
  installed and started (a launchd agent `local.get-me-there.camoufox-worker` on macOS, the systemd user unit
  `get-me-there-camoufox-worker.service` on Linux).
- **Resuming.** Any step that stops (no space, no `unzip`, a library missing, no consent yet) leaves the provider off,
  shown as not set up, never as failing; run `pnpm gmt setup --reconfigure browser` to carry on from where it stopped.
- **Consent.** Captured once, by you (below). Interactive setup on a machine with a display runs the capture itself,
  after the install. Asked nothing (`--non-interactive`), or on a machine with no display, it stops at the start check
  with "The worker needs your consent choice before it can start" and names the way for that machine: run
  `pnpm gmt consent` (or the export and import below), then `pnpm gmt setup --reconfigure browser` to finish.
- **The service.** It runs `<node> --conditions=@gmt/source --import tsx <checkout>/apps/camoufox-worker/src/run.ts main`
  from that package's directory with `PATH` and `HOME` only. Every start the worker refuses exits 78 and writes
  `start-refusal.json` (`{ reason, at }`) beside `worker.env`, a refusal of its own settings or files included (reason
  `config`; `pnpm gmt start` prints the worker's own words for it); it is never retried every minute (systemd's
  `RestartPreventExitStatus=78`; on macOS a 600 s throttle, and `pnpm gmt start`, `status` and `update` boot a refused
  agent out and say "refused, not retrying: …" with the fix). `pnpm gmt start`, `restart`, `update`, `setup` and
  `browser install` run the worker's start check first and do not start it while the check reports a reason. A stop
  waits up to 270 s (the longest page, 240 s, and 30 s to close the browser) before it ends the worker, so a page in
  flight finishes; the app's stop waits 30 s.

### Capture your consent choice

Google's consent page is answered once, by you, with "Reject all", and the worker then sets that choice before every
page. Interactive setup runs this capture itself; to run it again (or with the app in Docker):

```bash
pnpm gmt consent
```

1. With the worker service running, it first asks this machine's app whether a search is running: the native app, or
   the Docker app on the port compose publishes, with the basic auth in the checkout's `.env` (read, never printed).
   `--wait` waits for the search to end and `--force` goes ahead, as `stop` does; when Docker answers but its app's
   state cannot be read, it refuses unless `--force`. Then it stops the worker service alone; the app keeps running.
2. A Camoufox window opens on `https://www.google.com/travel/flights` in a new, throwaway profile, and the command says
   "Click **Reject all** in the window, wait until Google Flights shows, then close the window. Nothing else is
   needed". That one page load counts like any other (the page spacing, the monthly page count; it refuses during a
   cool-down and names its end).
3. Click **Reject all** on the first page, wait for Google Flights to show, and close the window. The tool clicks,
   types and navigates nothing itself; it only watches.
4. It keeps the `SOCS` cookie set or changed after your choice only when the cookie's own value reads as a rejection
   and your choice's submission carried none of the fields that only the "Accept all" form sent. That reading is the
   one observed on 2026-10-25 (darwin-arm64, the GB market, one "Reject all" and one "Accept all" session): the value's
   first field is 1 after "Reject all" and 2 after "Accept all". A choice made under "More options" has not been
   observed, so it is refused rather than guessed. The command writes the cookie 0600 with the time, deletes the
   throwaway profile, clears a consent refusal and starts the worker once its start check passes.

Anything else writes nothing, keeps a record already there exactly as it was, and says which: an Accept all, a value
this version does not read as a rejection, a window closed before the choice or before its cookie was set, a page
left for 10 minutes, a challenge page (which pauses the provider as on any page), a page that does not load, a first
view it does not recognise, or an account cookie. A region that shows no consent page at all writes nothing either:
the browser provider cannot start without a captured rejection, so capture one on a machine that is shown the page and
import it (below); if no machine you use is shown it, leave the provider off. Ctrl-C (or SIGTERM) closes the window,
deletes the throwaway profile and puts the worker back as it was. After anything but a stored rejection the worker is
put back as it was.

`pnpm gmt consent check` shows the stored choice without loading a page: when it was captured, its mark (`reject`),
and when it expires (the earlier of the cookie's own expiry and 13 months after the capture), exiting 0 only for a
rejection still in date. Run it once on a record you stored before this check existed. Capture again within 13
months; `pnpm gmt status` warns from 30 days before. The value comes from a signed-out throwaway profile and holds no
account cookie; only its first field is understood, so treat it as private and never print it (no command does). The
worker refuses to start, and never sets the cookie, when the stored value is not a rejection (`consent-not-rejection`),
and the Status view says "consent rejected" only when the stored mark is `reject`. Every refusal that needs a new capture names
`pnpm gmt consent`. A record left by an earlier version saying no consent page was shown, or voided, is not used: the
worker refuses it by name until you capture a rejection.

The fallback is `pnpm --filter @gmt/camoufox-worker capture-socs`: in an ordinary private browser window open
`https://www.google.com/travel/flights`, click **Reject all**, then open the cookie view (developer tools, Storage or
Application, cookies for `https://www.google.com`) and paste the `SOCS` cookie's value, expiry, Secure and SameSite
when asked (a few minutes). It stores the value only when it reads as a rejection, stamps the time and writes the same
file 0600; stop the worker first (`pnpm gmt stop --only worker`) and start it after (`pnpm gmt start --only worker`).

### Install or update the browser, whatever runs the app

`pnpm gmt browser install` installs or reinstalls this checkout's pinned Camoufox and its layout, whether the app runs
natively, in Docker or not at all; it needs no `app.env`. With a native app it first asks the app whether a search is
running (`--wait`, `--force`, as `stop` does). It removes what an interrupted attempt left (`.tmp-*` directories and
partial downloads under the install root), downloads only when the pinned archive is not already whole there, says the
size before the download and again before the unpack, and on Linux checks Firefox's libraries. Where the worker is set
up on this machine (its `worker.env` exists) it stops the worker, removes `CAMOUFOX_BINARY_BUILD` and
`CAMOUFOX_INSTALL_DIR` from `worker.env` if they are there (the install owns them), installs or re-renders the gmt
worker service (replacing a hand-written agent of the same label), and starts it once its start check passes. It then
removes every older bundle. The `layout` and `build-mismatch` refusals name it as their fix.

- **Where it lives and what it takes.** `~/.local/share/get-me-there/camoufox/`, private to you: the bundle in
  `browsers/official/<build>-<8 hex>/` (about 670 MB on macOS, 1.25 GB on Linux), and on macOS the `Camoufox.app` link and
  `version.json` camoufox-js reads. A download is removed once unpacked. One bundle is kept: any later successful
  install, setup or update removes the others.
- **Removing it.** `pnpm gmt uninstall` keeps it; `pnpm gmt uninstall --purge` deletes it with the data directory. By
  hand, with the worker stopped: `rm -rf ~/.local/share/get-me-there/camoufox`.
- **Linux sessions.** The worker is a user service like the app: without linger (section 0) it stops when you log
  out of the machine, whether or not the app's does.

### The app in Docker, the worker on this machine

The Docker app reaches a worker on the Mac at `host.docker.internal:8090` (Docker Desktop forwards it to the Mac's
loopback; on Linux, Docker cannot reach the host's loopback, so the browser provider needs the native app there). The
worker is set up by hand, in this order (the appendix below): its data directory and `worker.env`; then
`pnpm gmt browser install`, which installs the pinned Camoufox and the gmt worker service (the worker then refuses to
start with `consent-missing`, which is expected); then `pnpm gmt consent`, which captures your choice and starts the
worker once its check passes. After a `git pull` that changes the pin, run `pnpm gmt browser install` again (the worker refuses with
`build-mismatch` until you do). `pnpm gmt start --only worker`, `stop --only worker` and `restart --only worker` work
without `app.env`; stopping the worker does not ask the Docker app about a running search, so do it between runs. Point
the app at the worker as below.

### If you set the worker up by hand before

A worker set up from an earlier version of this section (Camoufox under `~/Library/Caches/camoufox`,
`CAMOUFOX_BINARY_BUILD` in `worker.env`, a launchd agent written by hand) refuses to start until the browser is
reinstalled where the install now puts it; nothing is copied from the old location.

1. `pnpm gmt browser install`: about 313 MB to download (on an Intel Mac 320 MB). It removes the two retired names
   from `worker.env`, replaces the hand-written agent with the gmt worker service (same label,
   `local.get-me-there.camoufox-worker`) and starts it once its check passes.
2. If the worker then refuses with `counts-missing`, its data directory is an earlier worker's (a pacer file, no counts
   file): run `pnpm gmt browser counts` (below).
3. The old `~/Library/Caches/camoufox` is not used any more; delete it when you like.

### On a machine with no display

The consent capture needs a browser window (with no `DISPLAY` or `WAYLAND_DISPLAY` set, `pnpm gmt consent` refuses
and says so), so on a server you capture it on a machine that is shown the consent page and has the pinned Camoufox
(`pnpm gmt browser install` there; no worker needs to be set up on it, and the consent command never downloads), and
pipe the one line it prints to the server:

```bash
pnpm gmt consent export | ssh <server> 'cd <checkout> && pnpm gmt consent import'
```

`export` prints `gmt-socs-v1.` followed by the cookie's fields, its capture time and its mark as its only standard
output (everything else it says goes to standard error) and writes nothing on the desktop. `import` refuses a line
given as an argument or typed at the terminal, checks it strictly (the name `SOCS`, the value's length and characters,
the domain `.google.com`, the path `/`, an expiry no later than 13 months after the capture, not expired), recomputes
the mark from the value and refuses anything but a rejection, then writes the file keeping the capture time and starts
the worker; its expiry is the line's, which export bounds by the capture plus 13 months. The line holds the cookie
from a signed-out throwaway profile (only its first field is understood), its capture time and its expiry: move it by pipe,
never as a command-line argument and never in a ticket. If you cannot pipe, use a private file and delete it on both machines:

```bash
(umask 077; pnpm gmt consent export > consent.line)   # on the desktop; copy consent.line to the server
pnpm gmt consent import < consent.line                # on the server
rm consent.line                                       # on both machines
```

The fallback is to read the `SOCS` cookie's fields from an ordinary private window on the desktop and enter them into
`pnpm --filter @gmt/camoufox-worker capture-socs` on the server (a few minutes; it too keeps only a rejection). Page
loads then come from the server's own address (above).

### Linux

The worker runs headless on Linux as on macOS, with no display. Camoufox's Linux bundle is the install directory itself
(`version.json`, `camoufox-bin`, `properties.json` and `fontconfig/` directly in it). Firefox needs its shared
libraries even headless: setup runs `ldd` over `camoufox-bin` and every `.so` in the bundle and names any that is
missing with its install line; on Ubuntu 24.04:
`sudo apt-get install libasound2t64 libatk1.0-0t64 libavcodec60 libcairo-gobject2 libcairo2 libdbus-1-3 libfontconfig1 libfreetype6 libgdk-pixbuf-2.0-0 libglib2.0-0t64 libgtk-3-0t64 libpango-1.0-0 libpangocairo-1.0-0 libx11-6 libx11-xcb1 libxcb-shm0 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1`
(Debian 12 also needs `libdbus-glib-1-2 libharfbuzz0b libxtst6`). The worker writes its own `fonts.conf` beside
`worker.env`, naming the bundle's `fonts/macos/` by absolute path, because the bundled one resolves fonts from the
working directory. Each `<os>-<arch>` earns its flags from recordings made under its own build; until `linux-arm64`
and `linux-x64` have theirs, the provider is not offered there. In Docker on Linux the app cannot reach the host's
loopback, so the Docker path on Linux leaves the provider off; the native app reaches it.

### The monthly caps across every caller

The worker enforces `CAMOUFOX_MONTHLY_PAGE_CAP` and `CAMOUFOX_MONTHLY_SCROLL_CAP` itself, for every app and recorder
that calls it together, over the ledger's billing month (from 00:00 UTC on `CAMOUFOX_BILLING_DAY`). It counts each page
before it loads (a crash over-counts, never under-counts) in `monthly.json` beside `worker.env`, refuses a page past the
page cap (the app names it as the browser worker's cap, counting every app and recording, with the worker's own count
and window end, and resumes a paused run when that window ends), and gives a grid page no more scrolls than the scroll
cap leaves. Counts start again at zero only once their own window has ended: changing `CAMOUFOX_BILLING_DAY`, or a clock
stepped back, carries them until then.

If that file is missing beside the pacer's file (an earlier worker's data) or cannot be read (invalid, or readable by
others), the worker refuses to start (`counts-missing`, `counts-unreadable`), a running worker refuses every page and
reports itself not ok, and the app skips the provider with that reason; the file is never rewritten with zeros. Run
`pnpm gmt browser counts` (also offered by `pnpm gmt setup --reconfigure browser`): it takes this month's browser pages
and scrolls from the native app's ledger, or as you give them (`--pages`, `--scrolls`; with the app in Docker its
Providers page shows both), adds any pages loaded outside the ledger that you state (`--other-pages`: recordings, another
app), shows the result, and on a yes stops the worker, has the worker write the file under its own lock, and starts it
again. A second app calling the same worker in one month is reported in the status, not refused.

### Key rotation

`pnpm gmt setup --reconfigure browser` asks whether to generate a new worker key (yes by default when the app's and the
worker's keys differ). It stops both services, writes the new key to `worker.env` and then `app.env` (each through a
0600 temporary file and a rename), and starts the worker and then the app. A run interrupted midway leaves the keys
differing, which a re-run repairs. No key is ever printed.

### Recordings

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
  Docker Desktop (with `CAMOUFOX_WORKER_PORT` set in `worker.env`, set `CAMOUFOX_WORKER_URL` to that port). Then
  `docker compose up -d`.
- **`pnpm dev`:** keep the two lines and `CAMOUFOX_WORKER_URL=http://127.0.0.1:8090` in a 0600 file such as
  `~/.config/get-me-there/dev-camoufox.env`, and load it into the shell that runs `pnpm dev` with
  `set -a; . ~/.config/get-me-there/dev-camoufox.env; set +a`, so the key is never typed or exported by hand and never
  reaches your shell history. Never put that URL in `.env`, where it would break the container.

Keep `CAMOUFOX_COOLDOWN_HOURS`, `CAMOUFOX_PAGE_TIMEOUT_SECONDS` and `CAMOUFOX_MIN_SPACING_SECONDS` equal on both sides (`worker.env` and the app's); the
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
  `CAMOUFOX_GRID_SCROLL_SPACING_SECONDS` (default 5, 0 to 30, never randomised; 0 means no pause, scrolls go back to back) between scroll clicks. Keep the grid settings
  equal in `worker.env` and the app's settings: the worker reports its scroll cap, spacing and page timeout, and the app
  skips the provider, naming the setting, while any of them differs. A page asks for no more scrolls than the run's and the month's
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
  for an hour. Google's no-flights page says nothing of day pairs it did not show: on the probe page past the planning
  horizon (the end of the sale window) its day pairs read as no data; on any other page only the pair it asked for
  does, and the rest stay not searched yet (resumable). Day pairs the grid could not show read as issues on the cell
  (resumable), never as prices. A 0-night stay opens its first block a day later and scrolls up once to it (with no
  scroll left, or a per-page cap of 0, it reads the view it opens on instead).

### Choose it

Add "Google Flights prices via Camoufox" to a definition's discovery providers. New definitions never include it.

### Check it

`pnpm --filter @gmt/camoufox-worker status` reads the key from `worker.env` itself and prints the worker's current status:
the cool-down, the account-cookie check, the verification flags and the versions. `lsof -nP -iTCP:8090 -sTCP:LISTEN`
shows it listening on `127.0.0.1` only. To see which navigation a stopped page refused, add `CAMOUFOX_LOG_DEBUG=true` to
`worker.env` and restart the worker: each refusal then also logs its path (never its query) in the agent's error log.

### Turn it off or recover

- Set `CAMOUFOX_ENABLED=false` and restart the app.
- Stop the worker alone with `pnpm gmt stop --only worker` (the app keeps running; `pnpm gmt start --only worker`
  starts it again after its start check), or by hand with
  `launchctl bootout gui/$(id -u)/local.get-me-there.camoufox-worker` on macOS or
  `systemctl --user stop get-me-there-camoufox-worker.service` on Linux. A page in flight finishes before the worker
  exits (its stop waits up to 270 s). `stop --only worker` and `restart --only worker` ask a native app about a running
  search first, as `stop` does.
- After a signed-in refusal: `pnpm --filter @gmt/camoufox-worker clear-signed-in` (it wipes the profile first).
- Deleting the cool-down record ends a pause early, which defeats its purpose.

### Appendix: the manual steps

`pnpm gmt setup` does all of this; these are the same steps by hand, for a machine where you would rather not run it
(the app in Docker, above). The install itself has no manual form: the worker launches only the bundle
`pnpm gmt browser install` (or `gmt setup`) installed, never one in `~/Library/Caches`, and refuses (exit 78) when the
layout differs from the pinned entry.

1. Create the worker's data directory, private to you: `mkdir -p -m 700 ~/.local/state/get-me-there/camoufox`
2. Create `~/.local/state/get-me-there/camoufox/worker.env` in an editor (never with `echo`) and make it private with
   `chmod 600 ~/.local/state/get-me-there/camoufox/worker.env`. It holds `CAMOUFOX_WORKER_KEY`, at least 32 random
   characters: generate them with `openssl rand -hex 24 > ~/.local/state/get-me-there/camoufox/key.tmp`, paste them from
   that file into `worker.env`, then delete `key.tmp`. A `worker.env` that still names `CAMOUFOX_BINARY_BUILD` or
   `CAMOUFOX_INSTALL_DIR` is refused (`pnpm gmt browser install` removes them): the build and its directory now come
   from the pinned entry. Copy the shared settings (the cool-down, page timeout, mode, grid
   scroll cap and spacing, monthly caps, billing day and fare market) from `app.env`, so both sides match.
3. Install the browser and the worker service with `pnpm gmt browser install`. The worker refuses to start with
   `consent-missing` until the next step, which is expected.
4. Capture your cookie choice with `pnpm gmt consent` (above); it starts the worker once its check passes. To try the worker in a terminal instead, stop the service (`pnpm gmt stop --only worker`) and run
   `pnpm --filter @gmt/camoufox-worker start` from a shell that has not loaded the app's `CAMOUFOX_*` lines (the worker
   refuses an inherited `CAMOUFOX_*` or `POINT_OF_SALE` that differs from `worker.env`, an inherited
   `CAMOUFOX_INSTALL_DIR`, and any `DEBUG`).

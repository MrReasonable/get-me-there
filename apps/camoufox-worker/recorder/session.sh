#!/bin/sh
# The recording sessions' runbook steps (spec §2 "Recordings first"; brief WP17 Task 17.8). A session for another
# `<os>-<arch>` entry (a Linux container, or this Mac under a throwaway HOME) loads its pages from the operator's own
# address, so the host's worker stops for it, the session's spacing starts from the host's last page, and the session's
# pages, scrolls and any pause come back to the host before its worker starts again.
#
#   session.sh before > line        on the host: refuses while a search runs (GET /api/executions/active, the app's
#                                   basic auth read from the host checkout's .env and never printed), stops the host
#                                   worker alone (pnpm gmt stop --only worker, from the host checkout), and prints the
#                                   host's `run.ts session export` line
#   session.sh run <args…>          runs the worker's run.ts with <args…> from this checkout, in the current
#                                   environment: inside the container, or under the throwaway HOME; e.g.
#                                   `session.sh run session seed < line`, `session.sh run record --landing`
#   session.sh after < line         on the host: merges the session's export line (`run.ts session merge`: the later
#                                   last-page time, the counts added, a longer pause carried), then starts the host
#                                   worker (pnpm gmt start --only worker) and shows its status
#
# GMT_HOST_CHECKOUT is the checkout the host's services run from (default: this repository's main worktree), so the
# worker service is stopped and started by the code that installed it. GMT_APP_URL is the app's address (default
# http://127.0.0.1:3000). The session line holds times and counts only; the script never prints a credential.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
pkg=$(cd "$here/.." && pwd)

run_worker() {
  cd "$pkg"
  exec node --conditions=@gmt/source --import tsx src/run.ts "$@"
}

host_checkout() {
  if [ -n "${GMT_HOST_CHECKOUT:-}" ]; then
    printf '%s\n' "$GMT_HOST_CHECKOUT"
    return
  fi
  common=$(git -C "$pkg" rev-parse --path-format=absolute --git-common-dir)
  dirname "$common"
}

# The app's active run, asked with the basic auth from the host checkout's .env; curl reads the credentials from its
# standard input (-K -), so they reach no command line and no output.
refuse_while_active() {
  env_file="$(host_checkout)/.env"
  url="${GMT_APP_URL:-http://127.0.0.1:3000}/api/executions/active"
  user=$(sed -n 's/^APP_BASIC_AUTH_USER=//p' "$env_file" 2>/dev/null | tail -n 1)
  pass=$(sed -n 's/^APP_BASIC_AUTH_PASS=//p' "$env_file" 2>/dev/null | tail -n 1)
  if [ -z "$user" ] || [ -z "$pass" ]; then
    echo "refused: no APP_BASIC_AUTH_USER and APP_BASIC_AUTH_PASS in $env_file, so whether a search runs is unknown" >&2
    exit 69
  fi
  answer=$(printf 'user = "%s:%s"\n' "$user" "$pass" | curl -sS --fail --max-time 10 -K - "$url") || {
    echo "refused: the app at $url did not answer whether a search runs" >&2
    exit 69
  }
  case "$answer" in
    *'"execution":null'*) ;;
    *)
      echo "refused: a search is running ($url); wait until it ends" >&2
      exit 75
      ;;
  esac
}

case "${1:-}" in
  before)
    refuse_while_active
    (cd "$(host_checkout)" && pnpm gmt stop --only worker) >&2
    cd "$pkg"
    node --conditions=@gmt/source --import tsx src/run.ts session export
    ;;
  run)
    shift
    run_worker "$@"
    ;;
  after)
    (cd "$pkg" && node --conditions=@gmt/source --import tsx src/run.ts session merge) >&2
    (cd "$(host_checkout)" && pnpm gmt start --only worker && pnpm gmt status --only worker) >&2
    ;;
  *)
    echo 'usage: session.sh before > line | session.sh run <run.ts args…> | session.sh after < line' >&2
    exit 64
    ;;
esac

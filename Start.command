#!/bin/bash
# Run from Finder or any working directory. Docker keeps the app running after this window closes.
set -euo pipefail
cd -- "$(dirname -- "$0")"
# Finder may not inherit the terminal's PATH (Docker Desktop and Homebrew).
export PATH="$HOME/.docker/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
if ! command -v docker >/dev/null 2>&1; then
  echo 'Install Docker Desktop, open it, then run Start.command again.' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo 'Open Docker Desktop and wait until it is running, then run Start.command again.' >&2
  exit 1
fi
if [ ! -f .env ]; then
  echo 'Missing .env: follow the one-line configuration in docs/setup.md, section 2.' >&2
  exit 1
fi
chmod 600 .env
# Validate without printing the resolved configuration, which contains credentials.
# The Status view shows which build is running; the image has no git, so the checkout's short SHA goes in as a build argument.
APP_VERSION="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
export APP_VERSION
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 240 app
printf '\nFlight scanner ready: http://127.0.0.1:3000\n'
# Whether .env gives NAME a value that is not empty, as compose reads it: the last line wins, an `export ` prefix,
# surrounding quotes and an unquoted value's inline comment are dropped, so NAME='' and NAME="" are empty. The value is
# compared, never printed.
env_set() {
  local line value
  line="$({ grep -E "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" .env || true; } | tail -n 1)"
  value="${line#*=}"
  value="${value#"${value%%[![:space:]]*}"}"
  case "$value" in
    \"*) value="${value#\"}"; value="${value%%\"*}" ;;
    \'*) value="${value#\'}"; value="${value%%\'*}" ;;
    \#*) value='' ;;
    *) value="${value%%[[:space:]]#*}"; value="${value%"${value##*[![:space:]]}"}" ;;
  esac
  [ -n "$value" ]
}
# With both sign-in lines set the app asks for that login; with either empty or missing it has no password (spec §4).
if env_set APP_BASIC_AUTH_USER && env_set APP_BASIC_AUTH_PASS; then
  printf 'Login: use APP_BASIC_AUTH_USER and APP_BASIC_AUTH_PASS from your local .env file.\n'
else
  printf 'No password: .env has no APP_BASIC_AUTH_USER and APP_BASIC_AUTH_PASS. Add them before another device, name, proxy or tunnel reaches the app, or if other people log in to this Mac (docs/setup.md section 1).\n'
fi

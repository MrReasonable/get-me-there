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
  echo 'Missing .env: follow the three-line configuration in docs/setup.md, section 2.' >&2
  exit 1
fi
chmod 600 .env
# Validate without printing the resolved configuration, which contains credentials.
# The Status view shows which build is running; the image has no git, so the checkout's short SHA goes in as a build argument.
APP_VERSION="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
export APP_VERSION
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 240 app
printf '\nFlight scanner ready: http://127.0.0.1:3000\nLogin: use APP_BASIC_AUTH_USER and APP_BASIC_AUTH_PASS from your local .env file.\n'

# syntax=docker/dockerfile:1
# get-me-there image. Spec §13 (deployment), §5.5 (NODE_ENV and IN_CONTAINER), §4 (fail-closed sqlite).
#
# Base image pin: the multi-platform INDEX digest of node:22-slim. To refresh it run
#   docker buildx imagetools inspect node:22-slim
# copy the top-level "Digest:" line into every FROM below, and update this block and the
# "Library notes" of docs/briefs/wp12-docker-docs.md.
# Recorded 2026-10-14: sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
#   (image created 2026-10-06, NODE_VERSION 22.23.3, Debian bookworm-slim).
# why node 22: it still bundles corepack; it is the supported runtime of spec §4. corepack verifies the
# pnpm download against the sha512 in package.json `packageManager`.
# why no apt-get anywhere: the image carries no curl or wget (spec §13); the health check and the
# operator's tool calls use node's fetch inside and curl on the host.

# ---- build: full install, sqlite assertion, every package and the SPA built ----
FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
# why: manifests first, sources after the install, so a source edit keeps the install layer (the cache mount also
# keeps the pnpm store between builds).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/providers/package.json ./packages/providers/
COPY packages/engine/package.json ./packages/engine/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN corepack enable pnpm \
 && test "$(pnpm --version)" = "$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '').replace(/\\+.*$/, '')")"
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY . .
RUN node scripts/assert-sqlite-prebuilt.mjs
RUN pnpm build

# ---- prod-deps: production dependencies of @gmt/api and its workspace dependencies only ----
FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS prod-deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
# why: manifests first, sources after the install, so a source edit keeps the install layer (the cache mount also
# keeps the pnpm store between builds).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/providers/package.json ./packages/providers/
COPY packages/engine/package.json ./packages/engine/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN corepack enable pnpm \
 && test "$(pnpm --version)" = "$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '').replace(/\\+.*$/, '')")"
# why: the filter keeps the SPA's React/Vite tree out of the runtime image; the SPA ships as static files.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@gmt/api..." --store-dir /pnpm/store
COPY scripts/assert-sqlite-prebuilt.mjs ./scripts/
RUN node scripts/assert-sqlite-prebuilt.mjs

# ---- runtime ----
FROM node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
ENV NODE_ENV=production
ENV IN_CONTAINER=1
WORKDIR /app
# why: the image keeps the workspace layout (root node_modules/.pnpm plus per-package symlinks), so
# workspace imports, the db package's migrations and airports paths, WP8's web root
# (apps/api/dist/bootstrap → apps/web/dist) and scripts/backup.mjs resolve exactly as in the repository.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=prod-deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=prod-deps /app/packages/providers/node_modules ./packages/providers/node_modules
COPY --from=prod-deps /app/packages/engine/node_modules ./packages/engine/node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/db/package.json ./packages/db/package.json
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=build /app/packages/db/data ./packages/db/data
COPY --from=build /app/packages/providers/package.json ./packages/providers/package.json
COPY --from=build /app/packages/providers/dist ./packages/providers/dist
COPY --from=build /app/packages/engine/package.json ./packages/engine/package.json
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
# why: only the scripts the image runs; the repository's lint, scan and test scripts stay out.
COPY --from=build /app/scripts/backup.mjs /app/scripts/check-backup.mjs /app/scripts/assert-sqlite-prebuilt.mjs /app/scripts/assert-dist-resolution.mjs ./scripts/
RUN node scripts/assert-dist-resolution.mjs
# why: a fresh named volume copies the ownership and mode of the image directory it is mounted on,
# so /data must exist and belong to node before VOLUME, or the first boot cannot write the database.
# /data/backups is 0700 like the directory @gmt/db's backupDatabase creates (it refuses a
# world-writable one); backups are <dirname(DATABASE_PATH)>/backups.
RUN node scripts/assert-sqlite-prebuilt.mjs \
 && mkdir -p /data/backups \
 && chown -R node:node /data \
 && chmod 0700 /data/backups
VOLUME ["/data"]
# why: non-root; every process started with `docker compose exec` or `run` is node as well, so the
# app, the backup script and the tools share one owner for the database and its -wal/-shm side
# files (plan decision 26).
USER node
EXPOSE 3000
# why: liveness only (plan decision 63): a 2xx answer from /api/health with `ok: true` (the database answers) is healthy; a `degraded` detail
# (scheduler jobs missing, a stuck run) shows in the UI and the logs and is never a restart trigger.
# The start period 240 s covers the read-only app_lock wait (up to 90 s behind another app's lock,
# 60 s behind a tool's, plan decision 53), the pre-migration backup, migrations and airport seeding.
HEALTHCHECK --interval=30s --timeout=5s --start-period=240s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => r.ok ? r.json() : { ok: false }).then((b) => process.exit(b.ok === true ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/api/dist/bootstrap/start.js"]

# Multi-stage build for the Vintrax API.
#
# Four stages, because the dependency set the build needs and the set the
# runtime needs are different and the difference is most of the image:
#
#   deps      full workspace install, so the build has the Nest CLI and tsc
#   build     compile @vintrax/shared, generate the Prisma client, nest build
#   proddeps  a second, production-only install
#   runtime   compiled output + production dependencies, nothing else
#
# The alternative — build, then copy build's node_modules — ships the Nest CLI,
# TypeScript, ESLint and Jest in the production image. A second install costs
# one cached layer and removes all of it.
#
# Debian slim rather than Alpine, as of the CARFAX extraction feature: that
# module drives a real headless Chromium through Playwright, which Playwright
# does not build for musl libc at all — Alpine is not a target Chromium
# supports, only a target Node happens to run on. `playwright install --with-
# deps` is written for apt, which is the other half of why this is Debian and
# not merely "some glibc image". This makes the runtime image meaningfully
# larger; that is the cost of the browser being real rather than a raw fetch,
# which is what issue #49 asked for after a raw fetch was tried and shelved
# (see decision D-036 and its own follow-up entry).
FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# ---- Dependencies -----------------------------------------------------------
FROM base AS deps
# Every workspace manifest is copied, not just this app's: the lockfile
# describes the whole workspace, and --frozen-lockfile fails on a missing one.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/client/package.json ./packages/client/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY mobile/package.json ./mobile/
RUN pnpm install --frozen-lockfile --filter @vintrax/backend...

# ---- Build ------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY . .
# @vintrax/shared resolves through its `main` field to dist/, so it is a real
# build artefact the API cannot start without.
RUN pnpm --filter @vintrax/shared build \
 && pnpm --filter @vintrax/backend exec prisma generate \
 && pnpm --filter @vintrax/backend build

# ---- Production dependencies ------------------------------------------------
FROM base AS proddeps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/client/package.json ./packages/client/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY mobile/package.json ./mobile/
RUN pnpm install --frozen-lockfile --filter @vintrax/backend... --prod
# The Prisma client is generated code, not a published artefact, so it has to be
# generated again against this install rather than copied from the build stage —
# pnpm's store paths differ between the two and a copied client resolves to a
# directory that is not there.
COPY backend/prisma ./backend/prisma
RUN pnpm --filter @vintrax/backend exec prisma generate

# ---- Runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# A fixed, explicit path rather than Playwright's per-user cache default: it
# has to be somewhere the `node` user this stage switches to can read after
# root did the installing, and a path under /app is what makes that an
# ordinary `chown` rather than a guess at where Playwright decided to put it.
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright-browsers
WORKDIR /app

# PID 1 in a container does not get the kernel's default signal handlers. Both
# runtimes register their own SIGTERM handler — Nest through enableShutdownHooks(),
# Next inside its standalone server — so the process does stop on a signal. The
# compose services additionally set `init: true`, which puts Docker's own init
# at PID 1 to reap orphans; `docker run --init` is the equivalent by hand.

# `--chown=node:node` here, not a separate `chown -R` afterward: node_modules
# is the largest thing this image copies, and re-walking it a second time to
# fix ownership costs a real amount of build time for no benefit over doing it
# during the copy itself. This is also the fix for a real deploy failure: the
# Prisma CLI's `migrate deploy` resolves its own engine binaries against what
# is on disk and, finding anything it needs to fetch or repair missing, writes
# into its own package folder under `node_modules` — copied in as root like
# everything else here, and unwritable by the `node` user this stage runs as.
# `prisma generate` in `proddeps` already puts the right engine in place, so
# this should be a no-op in the common case; it stops being one exactly when a
# mismatch would otherwise be a hard, unrecoverable failure instead of a quiet
# self-heal.
COPY --from=proddeps --chown=node:node /app/node_modules ./node_modules
COPY --from=proddeps --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --from=proddeps --chown=node:node /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/backend/package.json ./backend/
# Schema and migrations: `prisma migrate deploy` reads both at deploy time.
COPY --from=build --chown=node:node /app/backend/prisma ./backend/prisma

# The browser and its OS-level shared libraries, installed here rather than in
# `proddeps`: apt packages installed in an earlier stage do not travel with a
# `COPY` of an application directory, only files under that directory do. This
# has to run as root — both apt and writing under `PLAYWRIGHT_BROWSERS_PATH`
# for the first time need it — before the switch to the unprivileged user
# below. It also needs network access to CARFAX's page, at request time, not
# at build time; nothing about this step reaches CARFAX.
RUN apt-get update \
 && cd backend && npx --no-install playwright install --with-deps chromium \
 && cd .. \
 && rm -rf /var/lib/apt/lists/*

# Run unprivileged. The node image already provides this user.
RUN mkdir -p /app/backend/uploads \
 && chown -R node:node /app/backend/uploads /app/.playwright-browsers
USER node

WORKDIR /app/backend
EXPOSE 3001

# The liveness endpoint answers without touching the database, so a slow query
# cannot make the container look dead.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main"]

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
# Alpine again, not Debian slim: the Debian move (and the headless-Chromium
# install below it) was for driving a real browser against a CARFAX report,
# which issue #67 reverted back to five badges the dealer sets directly (see
# D-047, superseded). Nothing in this image talks to a browser any more, so
# there is no more reason to carry Chromium's own dependency footprint.
# node:22-alpine from AWS ECR Public's mirror of the Docker official images:
# the same image as Docker Hub's, without Hub's unauthenticated pull limit,
# which shared CI runners hit.
FROM public.ecr.aws/docker/library/node:22-alpine AS base
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
FROM public.ecr.aws/docker/library/node:22-alpine AS runtime
ENV NODE_ENV=production
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

# ffmpeg optimises uploaded promo tile videos and takes their poster frame
# (VideoProcessor). Without it the API refuses video uploads with a clear
# message instead of storing unoptimised originals.
RUN apk add --no-cache ffmpeg

# Run unprivileged. The node image already provides this user.
RUN mkdir -p /app/backend/uploads && chown -R node:node /app/backend/uploads
USER node

WORKDIR /app/backend
EXPOSE 3001

# The liveness endpoint answers without touching the database, so a slow query
# cannot make the container look dead.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main"]

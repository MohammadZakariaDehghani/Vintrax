# Multi-stage build for the Atlas API.
#
# The workspace is installed once with the full lockfile so the shared contract
# package resolves, then pruned to production dependencies for the runtime image.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# ---- Dependencies -----------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY backend/package.json ./backend/
RUN pnpm install --frozen-lockfile

# ---- Build ------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY . .
RUN pnpm --filter @atlas/shared build \
 && pnpm --filter @atlas/backend exec prisma generate \
 && pnpm --filter @atlas/backend build

# ---- Runtime ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/package.json ./backend/
COPY --from=build /app/backend/prisma ./backend/prisma

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

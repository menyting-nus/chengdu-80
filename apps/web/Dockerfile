# Builds and runs the TanStack Start app as a standalone Node server.
# No Cloudflare account, Alchemy, or Workers runtime is required.
#
# Build from the repo root so workspace packages resolve:
#   docker build -t chengdu80-web -f apps/web/Dockerfile .

FROM node:24-bookworm-slim AS node-runtime

FROM oven/bun:1 AS install
WORKDIR /repo
COPY package.json bun.lock ./
COPY patches patches
COPY apps/web/package.json apps/web/package.json
COPY packages/backend/package.json packages/backend/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS build
WORKDIR /repo
COPY --from=install /repo/node_modules /repo/node_modules
COPY --from=install /repo/apps/web/node_modules /repo/apps/web/node_modules
COPY --from=install /repo/packages/backend/node_modules /repo/packages/backend/node_modules
COPY --from=install /repo/packages/env/node_modules /repo/packages/env/node_modules
COPY --from=install /repo/packages/ui/node_modules /repo/packages/ui/node_modules
COPY . .
ENV NODE_ENV=production
# Self-hosted default: shared demo workspace, no WorkOS. The auth integration
# is selected at build time via these Vite-inlined env vars (see
# apps/web/src/integrations/auth/index.ts) — override at build time for
# account mode (unset these, provide WORKOS_* instead).
# VITE_CONVEX_URL is also inlined into the client bundle at build time
# (packages/env/src/web.ts), so it must be set here, not just at runtime.
ARG VITE_DEMO_MODE=1
ARG VITE_CONVEX_URL
ENV VITE_DEMO_MODE=${VITE_DEMO_MODE}
ENV VITE_CONVEX_URL=${VITE_CONVEX_URL}
RUN bunx --no-install vp run --filter web build

# The built server.js externalizes npm dependencies (React, TanStack, etc.),
# so the runtime image still needs node_modules alongside dist/.
FROM oven/bun:1 AS runtime
# Generated framework code runs in private Linux namespaces, never in this server process.
RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap util-linux bash && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /repo/apps/web/dist ./apps/web/dist
COPY --from=build /repo/apps/web/server ./apps/web/server
COPY --from=build /repo/apps/web/starter ./apps/web/starter
COPY --from=build /repo/apps/web/src/lib/contracts.ts ./apps/web/src/lib/contracts.ts
COPY --from=build /repo/packages/ui/src ./packages/ui/src
COPY --from=build /repo/packages/ui/node_modules ./packages/ui/node_modules
COPY --from=build /repo/packages/ui/package.json ./packages/ui/package.json
COPY --from=build /repo/packages/ui/components.json ./packages/ui/components.json
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/bun.lock ./bun.lock
COPY --from=build /repo/apps/web/package.json ./apps/web/package.json
EXPOSE 3001
WORKDIR /app/apps/web
CMD ["bun", "run", "start"]

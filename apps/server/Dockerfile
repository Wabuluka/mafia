# syntax=docker/dockerfile:1
# -----------------------------------------------------------------------------
# apps/server production image — multi-stage, non-root, slim final image.
#
# BUILD CONTEXT MUST BE THE MONOREPO ROOT, not apps/server/, because this is
# an npm workspaces project: package-lock.json, node_modules hoisting, and
# the @mafia/shared -> @mafia/server dependency all live at the root. Build
# from the repo root:
#
#   docker build -f apps/server/Dockerfile -t mafia-server .
#
# Three stages:
#   deps    — installs the full workspace's node_modules ONCE (cached by
#             Docker layer caching as long as lockfiles don't change),
#             including devDependencies, since compiling both @mafia/shared
#             and @mafia/server needs `tsc`.
#   build   — compiles @mafia/shared (see its tsconfig.build.json — this is
#             the ONLY reason that file exists: apps/server's own tsc build
#             produces CommonJS that `require()`s @mafia/shared at runtime,
#             which needs a real dist/, not the raw .ts source
#             transpilePackages/tsx read directly in dev — see that file's
#             own header) and then @mafia/server itself.
#   runtime — a fresh, slim base with ONLY production dependencies and the
#             compiled dist/ output from both packages. No TypeScript
#             compiler, no devDependencies, no source .ts files ship in the
#             final image.
# -----------------------------------------------------------------------------

FROM node:20-alpine AS deps
WORKDIR /repo
# Copy only manifests first so this layer is cached across builds that
# don't touch dependencies at all — the common case during iteration.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
# `npm ci` at the workspace root installs and hoists for every workspace in
# one pass — there is no per-workspace `npm ci` in an npm-workspaces repo.
# Full install (devDependencies included): the build stage needs `tsc`.
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /repo
# This workspace setup hoists everything into the root node_modules — no
# per-package node_modules directories exist to copy separately.
COPY --from=deps /repo/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server apps/server
COPY packages/shared packages/shared
# Build order matters — @mafia/server's tsc build `require`s @mafia/shared's
# compiled dist/ at typecheck time via its package.json#main (see that
# package's own comment on tsconfig.build.json for why a compiled dist even
# exists). Building shared first, matching the root package.json `build`
# script's own ordering, keeps this Dockerfile from silently drifting out
# of sync with how a local `npm run build` actually behaves.
RUN npm run build -w packages/shared
RUN npm run build -w apps/server

FROM node:20-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production

# Non-root user: alpine's `node` image ships a `node` user/group (uid/gid
# 1000) already — reusing it instead of inventing a new one keeps this
# image consistent with the base image's own convention.
RUN mkdir -p apps/server packages/shared

COPY --from=deps /repo/package.json /repo/package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json

# Production-only install, at the root, so npm workspace hoisting still
# resolves @mafia/shared -> packages/shared correctly for @mafia/server's
# `require('@mafia/shared')`. `--omit=dev` keeps `tsc`/vitest/etc — and
# everything apps/web needs — out of this image entirely; the server
# doesn't need apps/web's dependencies, but `npm ci` at the root has no
# per-workspace prod-install mode, so apps/web's package.json is
# deliberately NOT copied into this stage, which makes npm skip installing
# it (workspaces npm can't see aren't installed).
RUN npm ci --omit=dev

COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/server/dist apps/server/dist

# Drop root for the actual running process — the base image's built-in
# `node` user, not a fresh invented one, so file ownership below is a
# single explicit chown rather than user/group creation boilerplate.
RUN chown -R node:node /repo
USER node

EXPOSE 4000

# SIGTERM from `docker stop` (or the orchestrator's own shutdown signal)
# needs to reach the Node process directly for registerGracefulShutdown
# (db/connection.ts) to run at all — `npm start` as PID 1 would swallow it
# (npm doesn't forward signals to its child), so the compiled entrypoint is
# invoked directly with `node`, not via `npm run start`.
CMD ["node", "apps/server/dist/index.js"]

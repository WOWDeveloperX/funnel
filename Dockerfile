# syntax=docker/dockerfile:1
# Funnel Runtime — one container: Fastify API + built SPA, SQLite on a mounted volume (/data).

# ---- build ---------------------------------------------------------------------------------
FROM node:22.23.3-bookworm-slim AS build
WORKDIR /app

# Install with the lockfile first (better layer caching). better-sqlite3 ships N-API prebuilds
# for linux-x64/arm64 (glibc) inside its tarball, so no python/make/g++ toolchain is needed.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

COPY . .
# web (vite → apps/web/dist) then server (tsup → apps/server/dist/server.js, bundles @funnel/shared).
# Every @funnel/web package (react, router, recharts, framer-motion, tailwind, fonts…) is a
# devDependency — it only exists inside the vite bundle — so the prune leaves just the server's
# runtime deps (fastify, @fastify/static, zod, better-sqlite3): ~56 MB of node_modules.
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund

# ---- runtime -------------------------------------------------------------------------------
FROM node:22.23.3-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/funnel.db
WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
# SEED_CONFIG (configs/funnel-v1.json) is published + activated on first boot of an empty DB;
# TRANSLATIONS_DIR (configs/translations/*.json) is loaded on every boot.
COPY --from=build /app/configs ./configs

# No VOLUME instruction: Railway bans it ("Use Railway volumes instead"). Attach a Railway Volume
# at /data in the service settings; locally `docker run -v funnel-data:/data …` works the same.
# Runs as root on purpose: Railway volumes are mounted root-owned, so a non-root user could not write /data.
RUN mkdir -p /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "apps/server/dist/server.js"]

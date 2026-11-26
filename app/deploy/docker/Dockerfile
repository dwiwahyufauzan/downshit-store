# Opsi C (Docker). BELUM DIUJI di mesin pengembangan (Docker tidak terpasang). Konteks build = folder app/:
#   docker build -f deploy/docker/Dockerfile -t downshit .
# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/build ./build
# Runner migrasi berversi (tsx + drizzle-orm ada di dependencies; drizzle-kit tidak diperlukan)
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/migrate.ts ./scripts/migrate.ts
COPY --from=build /app/src/lib/server/db/migrator.ts /app/src/lib/server/db/legacy-catchup.ts ./src/lib/server/db/
# DATABASE_URL=/data/downshit.db dan UPLOAD_DIR=/data/uploads berada di volume
RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node
EXPOSE 3000
# migrasi dulu (idempoten), baru aplikasi
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && node build"]

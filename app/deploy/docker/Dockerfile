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
# DATABASE_URL=/data/downshit.db dan UPLOAD_DIR=/data/uploads berada di volume
RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node
EXPOSE 3000
CMD ["node", "build"]

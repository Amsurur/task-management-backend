# Multi-stage build for the Task Management API.
#
# 1. deps    — install all deps (incl. dev) for building
# 2. build   — generate Prisma client + tsc compile to dist/
# 3. runtime — slim image with prod deps + dist + Prisma client/schema only

# --- deps --------------------------------------------------------------------
FROM node:20-slim AS deps
WORKDIR /app
# OpenSSL is required by Prisma's query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm install

# --- build -------------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .
RUN npx prisma generate && npm run build

# --- runtime -----------------------------------------------------------------
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Prod deps only, plus the Prisma CLI (a devDependency) so `migrate deploy`
# can run at startup against the production database.
RUN npm install --omit=dev && npm install prisma@5.22.0

# Compiled app + generated Prisma client + schema (needed for migrate deploy).
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /app/src/prisma ./src/prisma

USER node
EXPOSE 3000
# Apply pending migrations against the production DB, then start the server.
CMD ["sh", "-c", "npx prisma migrate deploy --schema=src/prisma/schema.prisma && node dist/server.js"]

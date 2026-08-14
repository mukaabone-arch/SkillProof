# ---- build ----
FROM node:20-slim AS build

# Prisma needs OpenSSL; node:slim doesn't ship it
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests + schema first. The schema is needed at install time because
# `postinstall` runs `prisma generate`, which reads it.
COPY package*.json ./
COPY prisma ./prisma

RUN npm ci

COPY . .

# `build` script is: prisma generate && nest build  -> outputs to dist/
RUN npm run build

# Drop dev dependencies from node_modules for the runtime image
RUN npm prune --omit=dev


# ---- runtime ----
FROM node:20-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# App Runner sets PORT; main.ts falls back to 4000 if unset
ENV PORT=4000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json

# UPLOAD_DIR default is <cwd>/uploads. This is EPHEMERAL in a container —
# files written here are lost on every restart and redeploy. Present only so
# the startup mkdirSync succeeds; replace with S3 before real users.
RUN mkdir -p /app/uploads

EXPOSE 4000

CMD ["node", "dist/main.js"]

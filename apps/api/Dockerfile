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

# The Prisma CLI (needed at runtime for `prisma migrate deploy` — see
# docker-entrypoint.sh) survives the prune above even though `prisma` is a
# devDependency: package-lock.json marks it `devOptional` because
# @prisma/client (a real dependency) declares `prisma` as a required
# peerDependency, and npm's prune correctly keeps anything satisfying a
# production package's required peer. Confirmed by building this image and
# running `prisma migrate deploy` against a live database — no extra
# install step needed (one was tried and cost +300MB for a package that
# was already present). This check exists so a future change that breaks
# that retention (e.g. `prisma` becoming an optional peer of a newer
# @prisma/client) fails the BUILD loudly, not every container's startup.
RUN test -x node_modules/.bin/prisma || \
    (echo "FATAL: node_modules/.bin/prisma is missing after prune — the Prisma CLI is no longer retained by npm's peer-dependency resolution. docker-entrypoint.sh needs it to run migrations at startup. See this RUN command's own comment." >&2 && exit 1)

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
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# UPLOAD_DIR default is <cwd>/uploads. This is EPHEMERAL in a container —
# files written here are lost on every restart and redeploy. Present only so
# the startup mkdirSync succeeds; replace with S3 before real users.
RUN mkdir -p /app/uploads

EXPOSE 4000

# Runs `prisma migrate deploy` before starting the app, exiting non-zero
# (never reaching node) if migrations fail — see docker-entrypoint.sh's own
# doc comment for why, and DIRECT_URL/DATABASE_URL requirements.
CMD ["./docker-entrypoint.sh"]

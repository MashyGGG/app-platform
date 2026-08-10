# Local testing image: builds BOTH apps, then compose starts one process per app.
#
# Purpose is to run app-web / admin-web on localhost while they talk to the real
# Vercel-side services (Neon, Upstash) — see docker-compose.remote.yml. This is
# NOT how production is deployed; Vercel builds from the repository itself.
#
# Running on Linux here is deliberate: it exercises the same native artefacts as
# the deployment (the Prisma query engine, @node-rs/argon2), which a Windows or
# macOS `pnpm dev` does not.
FROM node:22-bookworm-slim

# Prisma's query engine links against OpenSSL; ca-certificates is needed to reach
# Neon and Upstash over TLS.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    # The repository is copied without .git, so husky's `prepare` script has
    # nothing to install into.
    HUSKY=0
RUN corepack enable

WORKDIR /app

# Manifests first so `pnpm install` is only re-run when a dependency changes,
# not on every source edit.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/app-web/package.json apps/app-web/
COPY apps/admin-web/package.json apps/admin-web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .

# A syntactically valid placeholder, never connected to. Next evaluates route
# modules while building, and those construct the Prisma client, which reads
# DATABASE_URL at construction time. The real value arrives at runtime from
# docker-compose.remote.yml's env_file — so no credential is ever baked into
# this image.
ENV DATABASE_URL="postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder"

# Builds both apps. `NEXT_PUBLIC_*` is inlined here rather than read at runtime;
# leaving NEXT_PUBLIC_APP_URL unset makes the password-reset link fall back to
# http://localhost:3000, which is what you want when testing locally.
RUN pnpm turbo run build

EXPOSE 3000 3001

# Overridden per service in docker-compose.remote.yml.
CMD ["pnpm", "turbo", "run", "start"]

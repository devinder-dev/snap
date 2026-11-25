# The backend as a container image. Two targets:
#
#   docker build --target app   -t snap-app   backend    api, worker and sweep
#   docker build --target tools -t snap-tools backend    migrations and the e2e
#
# The api, the worker and the sweep are one image with a different command
# each, so there is one thing to build, scan and ship:
#
#   api      (default)  bun --sql-preconnect src/index.ts
#   worker              bun --sql-preconnect src/worker.ts
#   sweep               bun scripts/sweep.ts
#
# What goes into the image at all is decided by .dockerignore (an allowlist).

# Step 1: The base. Pinned to the Bun the code is developed and tested with.
FROM oven/bun:1.4.5-slim AS base
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# The package files on their own, before any code: as long as they don't
# change, Docker reuses the installed packages from its cache, and a code
# change rebuilds in seconds.
COPY package.json bun.lock ./

# Step 2: Production packages only. --frozen-lockfile installs exactly what
# bun.lock says, and fails instead of quietly picking other versions.
FROM base AS prod-deps
RUN bun install --frozen-lockfile --production

# Runtime has no shell. Compose invokes Bun directly for jobs and health checks.
FROM oven/bun:1.4.5-distroless AS app
WORKDIR /app
COPY --from=prod-deps /app/package.json /app/bun.lock ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
COPY scripts/sweep.ts ./scripts/sweep.ts
ENV HOST=0.0.0.0
USER 65532:65532
EXPOSE 3000
ENTRYPOINT []
CMD ["/usr/local/bin/bun", "--sql-preconnect", "src/index.ts"]

# Step 4: tools — every package, dev ones included: dbmate for the
# migrations, socket.io-client for the e2e. Runs the migrations by default.
FROM base AS tools
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY db ./db

USER bun
CMD ["bun", "scripts/migrate.ts"]

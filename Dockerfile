# NEXORA production image: Next.js standalone server, non-root, with a readiness healthcheck.
# Build:  docker build -t nexora --build-arg APP_RELEASE=$(git rev-parse --short HEAD) .
# Run:    docker run -p 3000:3000 --env-file deploy/.env nexora
# Every setting is read at runtime (including the Supabase URL and anon key), so one image
# serves any environment.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ARG APP_RELEASE=dev
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_RELEASE=$APP_RELEASE
RUN addgroup -S nexora && adduser -S -G nexora nexora && mkdir -p /app/.data && chown nexora:nexora /app/.data
COPY --from=build --chown=nexora:nexora /app/.next/standalone ./
COPY --from=build --chown=nexora:nexora /app/.next/static ./.next/static
COPY --from=build --chown=nexora:nexora /app/public ./public
USER nexora
EXPOSE 3000
# Demo mode keeps its data in /app/.data: mount a volume there to keep it across restarts.
VOLUME ["/app/.data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]

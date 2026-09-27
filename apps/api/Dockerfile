# syntax=docker/dockerfile:1.7

FROM node:26.8.2-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/product-intelligence/package.json packages/product-intelligence/package.json
COPY packages/ucp-client/package.json packages/ucp-client/package.json
COPY services/connectors/package.json services/connectors/package.json

RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts --no-audit --no-fund

FROM deps AS build
COPY tsconfig.json tsconfig.base.json ./
COPY apps/api apps/api
COPY packages packages
COPY services services
COPY database database

RUN npm run build

FROM node:26.8.2-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV CATALOG_HTTP_MAX_CONNECTIONS_PER_ORIGIN=64
ENV CONNECTOR_DNS_CACHE_ENABLED=true
ENV CONNECTOR_DNS_CACHE_TTL_MS=30000
ENV CONNECTOR_DNS_CACHE_MAX_ENTRIES=512
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/product-intelligence/package.json packages/product-intelligence/package.json
COPY packages/ucp-client/package.json packages/ucp-client/package.json
COPY services/connectors/package.json services/connectors/package.json

RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund && \
    npm cache clean --force

COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/product-intelligence/dist packages/product-intelligence/dist
COPY --from=build /app/packages/ucp-client/dist packages/ucp-client/dist
COPY --from=build /app/services/connectors/dist services/connectors/dist
COPY database/migrations database/migrations

USER node
EXPOSE 3000

CMD ["node", "apps/api/dist/production.js"]

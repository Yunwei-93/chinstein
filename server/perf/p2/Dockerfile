# Build from server/: docker build -f perf/p2/Dockerfile -t chinstein-p2-loadgen .
FROM grafana/k6:2.2.0 AS k6-runtime

FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=k6-runtime /usr/bin/k6 /usr/local/bin/k6
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# The signer gate compares the compiled output with these source inputs.
COPY package.json tsconfig.json ./
COPY src/auth.ts ./src/auth.ts
COPY perf ./perf

RUN chmod 0555 /app/perf/p2/load-generator-entrypoint.sh

USER node

ENTRYPOINT ["/app/perf/p2/load-generator-entrypoint.sh"]

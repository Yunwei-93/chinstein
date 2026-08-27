FROM node:22-slim AS builder

WORKDIR /app

# copy manifests first so `npm ci` stays cached when only sources change
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# drop devDependencies so the runtime stage inherits a lean node_modules
RUN npm prune --omit=dev


# ---------- Runtime ----------
FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# copy artefacts only — no .ts sources, no TypeScript compiler
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
COPY db ./db

# don't run as root — limits the blast radius if the app is compromised
USER node

EXPOSE 3000

# exec form keeps node as PID 1 so it receives SIGTERM directly
CMD ["node", "dist/index.js"]
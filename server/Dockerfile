# QueryCraft server, production image (IMPLEMENTATION.md 22, M8).
# Build: docker build -t querycraft-server server
# Run:   docker run --env-file server/.env -p 4000:4000 querycraft-server
# Env comes from the runtime environment; .env files are never copied into the image.
# Migrations and knowledge-base scripts run from a development checkout (README).

FROM node:24.22.3-alpine3.24 AS base
WORKDIR /app
RUN corepack enable

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24.22.3-alpine3.24 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]

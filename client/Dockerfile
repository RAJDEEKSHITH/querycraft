# QueryCraft client, production image (IMPLEMENTATION.md 22, M8): static build served by nginx.
# Build: docker build -t querycraft-client --build-arg VITE_API_BASE_URL=http://localhost:4000 client
# Run:   docker run -p 8080:80 querycraft-client
# The API URL is fixed at build time; the server's CLIENT_ORIGIN must match the client's origin.
# .env files are never copied into the image.

FROM node:24.22.3-alpine3.24 AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY public ./public
COPY src ./src
ARG VITE_API_BASE_URL=http://localhost:4000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN pnpm build

FROM nginx:1.31.8-alpine3.24 AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

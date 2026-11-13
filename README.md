# QueryCraft

> **Ask your Postgres database questions in plain English. Safe by design, measured for accuracy.**

**Status: in development.** This is a short stub; the full technical README is written when the project is finished.

## Setup

Prerequisites: Node.js LTS, pnpm, Docker with Compose.

1. Create the env files from the examples and set real values:
   - `.env` from `.env.example` (Docker database passwords)
   - `server/.env` from `server/.env.example`
   - `client/.env` from `client/.env.example`
2. Start PostgreSQL (first start loads AdventureWorks and applies the read-only grants):

   ```sh
   docker compose up -d --build
   ```

3. Install dependencies and apply migrations:

   ```sh
   cd server && pnpm install && pnpm db:migrate
   cd ../client && pnpm install
   ```

4. Run the dev servers (in two terminals):

   ```sh
   cd server && pnpm dev
   cd client && pnpm dev
   ```

## Checks

Run in `server/` and `client/`:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Server tests need the Docker database running and a complete `server/.env`.

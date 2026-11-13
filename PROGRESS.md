# QueryCraft Progress

Verified facts only. Read at the start of every session (see `CLAUDE.md` section 2).

## Handoff

- **Current milestone:** M0 — Foundation and infrastructure
- **Current task:** M0 complete; completion report given (2026-11-13). Waiting for the user.
- **Last completed step:** all M0 tasks ticked; all four checks pass in both packages; `NOTES.md` updated. Fixed `db:migrate` running Drizzle's migrator with zero migrations (new `src/db/migrations.ts` + `test/db/migrations.test.ts`; recorded in NOTES.md problems). Tasks 5–7 server files: `src/index.ts`, `src/app.ts`, `src/config/load-dotenv.ts`, `src/lib/{errors,logger}.ts`, `src/http/routes.ts`, `src/http/controllers/health.controller.ts`, `src/http/middleware/{request-logger,error-handler}.ts`, `src/services/health.service.ts`, `src/db/{app,reader,migrate,schema}.ts` (scaffold `src/db/index.ts` removed), `src/safety/executor.ts` (`pingReader` only), `drizzle.config.ts` (uses `APP_DATABASE_URL`), `vitest.config.ts`, `test/setup.ts`, `test/helpers/log-capture.ts`, tests in `test/{config,lib,http,db}/`, `test/startup.test.ts`, `test/architecture.test.ts` (a temporary forbidden import made it fail as expected; probe file removed). Before that: task 4 — `server/src/config/env.ts` (`envSchema` mirrors `server/.env.example`; empty values = missing; failure returns names only; `TEST_APP_DATABASE_URL` required only when `NODE_ENV=test`; hard cost limit > soft) and `server/test/config/env.test.ts` (23 tests incl. sync check against `.env.example` and no-value-leak check) pass. Before that: task 3 — lorint pinned, Docker built and verified (see "Docker verification"); container `querycraft-postgres` running and healthy. Earlier: task 2 — scripts in both packages; server `tsconfig.json` (typecheck: src + test + configs, `noEmit`) and `tsconfig.build.json` (src → dist); server `eslint.config.js` (typed `recommendedTypeChecked`, `no-non-null-assertion`, explicit return types in `src/services` and `src/safety`); client: `typecheck`/`test` scripts, explicit `strict`, minimal `App.tsx`, no `!` in `main.tsx`, title `QueryCraft`, Vite demo assets removed
- **Next step:** when the user says "continue", start M1 with the milestone plan (`CLAUDE.md` section 3; read `IMPLEMENTATION.md` 13, 10.3 `audit_events`, 21, 22 M1).
- **Files changed but unfinished:** none
- **Pending approvals / questions:** optional — whether to drop the empty Drizzle bookkeeping table `drizzle.__drizzle_migrations` created in both app databases by the pre-fix `db:migrate` run (harmless; Drizzle creates it with the first real migration in M1 anyway). The user confirmed (2026-11-13) that the root `.env` is filled and fixed `ADMIN_TOKEN` in `server/.env`; do not check either.
- **Last command results (2026-11-13, end of M0, real exit codes):** server `pnpm typecheck` 0, `pnpm lint` 0, `pnpm test` 0 (10 files, 91 tests), `pnpm build` 0; client `pnpm typecheck` 0, `pnpm lint` 0, `pnpm test` 0 (no test files, `--passWithNoTests`), `pnpm build` 0. `pnpm db:generate`: "No schema changes" (creates an empty `server/drizzle/` folder). `pnpm db:migrate` (after fix): "No migrations generated yet in server/drizzle; nothing to apply." Manual `pnpm dev`: listening on port 4000; `GET /api/health` → 200 `{"status":"ok","appDb":"up","readerDb":"up"}` with a UUID `X-Request-Id`; `GET /api/nope` → 404 contract body; logs showed only level, msg, id, method, path, statusCode. Dev process stopped (the `tsx watch` child had to be stopped separately; port 4000 confirmed free).

### M0 plan decisions (approved by the user, 2026-11-13)

1. All requested dependencies approved, including server `typescript@~6.0.3` (replacing 7.0.2). No LLM/embedding SDK packages in M0.
2. Reader health check: option A. `safety/executor.ts` is created in M0 with only a fixed `pingReader()`; M1 adds the executor. Rule 9.3.1 stays unchanged.
3. `.claude/settings.json` fixed with `**/.env*` deny rules; existing ask/allow rules kept. Done.
4. The compose file is `docker-compose.yml` (the user renamed it; content identical to the old `.yaml`, CRLF line endings).
5. Pin the lorint `install.sql` / `update_csvs.rb` downloads to a commit SHA and record it.
6. `GET /api/health` returns 503 when either database is down; bodies over 10 kB and malformed JSON return 400 `VALIDATION_ERROR`.

### M0 plan adjustments for the provider change

- **Env schema (task 4)** mirrors the new `server/.env.example`: `GROQ_API_KEY`, `LLM_MODEL`, `LLM_ANSWER_MODEL` (optional; empty means use `LLM_MODEL`), `GEMINI_API_KEY`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` (fixed at 768), the three prices (≥ 0, 0 allowed), `PROVIDER_MAX_RETRIES`, `PROVIDER_MAX_WAIT_MS`, `DAILY_TOKEN_BUDGET` (replaces `DAILY_BUDGET_USD`); `OPENAI_API_KEY` is gone. All other variables are unchanged. The env loader stays dotenv, because the scaffold uses it.
- **Docker verification (task 3)** also checks that `pg_trgm` exists in `querycraft_app` and `querycraft_test`, along with `vector`.
- No other M0 impact: §10.3 (768-dim vectors, `daily_usage`, trigram index) applies from M2; §17's `UPSTREAM_RATE_LIMITED` and retry handling apply from M3.

### Dependencies installed (approved by the user, 2026-11-13)

- Zod check: `@langchain/core` 1.4.0 depends on `zod ^4.6.6`; `@langchain/langgraph` 1.7.4 peers `zod ^3.25.32 || ^4.2.0` → zod 4 chosen.
- Server dependencies: `zod` 4.6.7, `pino` 10.4.0, `pino-http` 11.0.0, `helmet` 8.3.0, `cors` 2.8.6.
- Server devDependencies: `vitest` 5.1.0, `supertest` 7.3.2, `@types/supertest` 7.2.1, `@types/cors` 2.8.19, `eslint` 10.14.0, `@eslint/js` 10.0.1, `typescript-eslint` 8.72.2, `globals` 17.14.0, `typescript` 7.0.2 → 6.0.3.
- Client devDependencies: `vitest` 5.1.0.
- pnpm printed "Agent skills awaiting approval: drizzle-kit"; not approved (not a package, not requested).

## Milestones

| Milestone | Status |
|---|---|
| M0 — Foundation and infrastructure | Complete (2026-11-13; report given) |
| M1 — Safety layer | Not started |
| M2 — Knowledge base and retrieval | Not started |
| M3 — Agent graph | Not started |
| M4 — Evaluation harness | Not started |
| M5 — HTTP API and streaming | Not started |
| M6 — Client | Not started |
| M7 — MCP server | Not started |
| M8 — Finish | Not started |

## Current milestone tasks (M0)

- [x] 1. Inspect `client/` and `server/` scaffolds; record what exists (see Facts recorded)
- [x] 2. `typecheck`, `lint`, `test`, `build`, `dev` scripts in both packages (server lint is clean once task 6 replaces the scaffold DB files)
- [x] 3. Pin lorint downloads to a commit SHA; verify the Docker setup: build, first start, data load, roles, grants, `vector` + `pg_trgm`; record the base-table count
- [x] 4. Server env schema with Zod (Groq/Gemini variables); `server/.env.example` in sync
- [x] 5. Express app: request id, pino-http, helmet, CORS, 10 kB body limit, `AppError` + error handler, `GET /api/health`
- [x] 6. App pool, test pool, reader pool; Drizzle config + migrate script for app/test databases (no tables)
- [x] 7. Vitest in both packages; architecture test; database-role tests
- [x] 8. `README.md` stub and `NOTES.md` (section 26 structure, decisions seeded from section 27)

## Last verification

| Check | client | server |
|---|---|---|
| Typecheck | ✓ (2026-11-13) | ✓ (2026-11-13) |
| Lint | ✓ (2026-11-13) | ✓ (2026-11-13) |
| Tests | ✓ no test files yet (until M6) | ✓ 10 files, 91 tests (2026-11-13) |
| Build | ✓ (2026-11-13) | ✓ (2026-11-13) |

## Facts recorded

### Toolchain (2026-11-13)

- Node v24.22.3; global pnpm 12.4.2 (server `packageManager` pins pnpm 12.18.0 with `onFail: download`); Docker 29.7.2; Compose v5.4.0.
- Before task 3 no `querycraft` Docker volume existed; task 3 created `querycraft_querycraft-pgdata`.
- Git: branch `main`, one commit `0b90d02 initial setup`, working tree clean.

### Client scaffold

- Vite 8 + React 19 + Tailwind 4 (`@tailwindcss/vite`) + axios; TypeScript ~6.0.3 (strict on by TS 6 default, not explicit in tsconfig); ESLint 10 + typescript-eslint 8.72 (supports TypeScript `>=4.8.4 <6.1.0`).
- Scripts: `dev`, `build` (`tsc -b && vite build`), `lint`, `preview`. Missing: `typecheck`, `test`.
- `src/App.tsx` is the Vite demo page and imports a missing `./App.css` → build fails. `src/main.tsx` uses a non-null `!`. `index.html` title is `client`.
- `client/.env.example`: `VITE_API_BASE_URL`.

### Server scaffold

- Express 5.3, drizzle-orm + drizzle-kit `1.0.0-rc.5`, `pg`, `dotenv` (kept, per spec 7.1), dev: `tsx`, `@types/express`, `@types/node`, `@types/pg`, TypeScript `^7.0.2` (installed 7.0.2 = native port; ships no compiler API, so typescript-eslint cannot run against it).
- Scripts: only a placeholder `test` that exits 1.
- `drizzle.config.ts` and `src/db/index.ts` read `DATABASE_URL`, which is not in `server/.env.example` (`APP_DATABASE_URL`, `TEST_APP_DATABASE_URL`, `READER_DATABASE_URL` are). `src/db/schema.ts` is empty.
- `tsconfig.json`: strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `rootDir: ./src` (excludes tests), `include` names a non-existent `src/db/learn.schema.ts`, sets `jsx`.
- `pnpm-workspace.yaml` sets `allowBuilds: esbuild: false`.

### Docker verification (2026-11-13, task 3)

- `docker compose up -d --build` built `querycraft-postgres:17` and created volume `querycraft_querycraft-pgdata`; the container became `healthy`. Init log: "roles and databases created", "AdventureWorks base tables loaded: **68**", "qc_reader grants applied", "init process complete".
- **68 AdventureWorks base tables** (catalog query as `postgres`): humanresources 6, person 13, production 25, purchasing 5, sales 19.
- Databases: `adventureworks` (owner `postgres`, ACL `postgres=CTc`, `qc_reader=c` only), `querycraft_app` and `querycraft_test` (owner `qc_app`, ACL `qc_app=CTc` only). Both app databases have `vector` 0.8.7 and `pg_trgm` 1.6; their `public` schema is owned by `qc_app` with no `PUBLIC` privileges.
- Roles: `qc_reader` login, connection limit 5, not superuser/createdb/createrole, config `default_transaction_read_only=on`, `statement_timeout=5s`, `idle_in_transaction_session_timeout=10s`. `qc_app` login, no special attributes.
- `qc_reader` privileges: `USAGE` only on the five schemas (none on `public`, `hr`, `pe`, `pr`, `pu`, `sa`); `CREATE` on no schema; on `adventureworks` `CONNECT` only (no `CREATE`, no `TEMP`); no `CONNECT` on `querycraft_app`/`querycraft_test`. Table-level `SELECT` on 65 base tables; `person.password` none; `sales.creditcard` column grants without `cardnumber`; `humanresources.employee` column grants without `nationalidnumber`, `loginid`; 0 non-SELECT table privileges; 0 of 89 views granted. `adventureworks` `public` schema ACL is `pg_database_owner=UC` only.
- No defects found; no infra fixes needed.
- After M0: both app databases contain only Drizzle's empty bookkeeping table `drizzle.__drizzle_migrations` (from the pre-fix `db:migrate` run); no app tables.

### M0 test coverage (2026-11-13)

- `test/config/env.test.ts` (23), `test/lib/errors.test.ts`, `test/http/app.test.ts` (404 shape, request id, helmet, CORS, malformed/oversized JSON → 400, logs without headers/query, 500 without internals), `test/http/health-mocked.test.ts` (503 paths, no driver messages in logs), `test/http/health.test.ts` (real DBs → 200), `test/startup.test.ts` (invalid env → exit 1, names only), `test/db/app-db-guard.test.ts`, `test/db/migrations.test.ts`, `test/architecture.test.ts`, `test/db/reader-role.test.ts` (34 tests against `qc_reader`).

### Docker / infra (static review)

- Files match section 24. The compose file is now `docker-compose.yml` (renamed by the user; same content as the old `.yaml`).
- Init scripts have LF endings (re-checked after the user's edit to `01-roles-and-databases.sh`, which adds `CREATE EXTENSION IF NOT EXISTS pg_trgm` in the app and test databases). Roles, databases, extensions, role defaults and grants match section 10.1 on reading. The lorint `install.sql` and `update_csvs.rb` downloads are pinned to commit **`b474991f0df1c4bf55ca4735eb0254ca0709eed2`** (master HEAD, 2026-06-29, "Merge pull request #21 from WJ44/master"); both files returned HTTP 200 at that SHA (194,955 and 4,256 bytes). The Microsoft CSV zip is a GitHub release asset (not pinnable by commit).

### Repository

- `.claude/settings.json` (fixed 2026-11-13): it was misspelled `setttings.json` and not loaded. Its deny rules are now `Read(**/.env)`, `Read(**/.env.local)`, `Read(**/.env.development)`, `Read(**/.env.production)`, `Read(**/.env.test)`, `Read(**/.env.*.local)`, plus matching `Edit(...)` rules for the same six patterns (Edit rules also cover file writes; `.env.example` stays readable and editable); the npm/yarn/force-push/hard-reset denies and all ask/allow rules are unchanged. It takes effect when the session restarts.
- `.gitignore` (user change): now ignores only `NOTES.md` among the docs, so `CLAUDE.md`, `IMPLEMENTATION.md`, `PROGRESS.md` are no longer ignored (currently untracked).
- Uncommitted user changes at 2026-11-13: `.gitignore`, `docker-compose.yaml` → `docker-compose.yml`, `infra/postgres/init/01-roles-and-databases.sh`, `server/.env.example`; replaced `CLAUDE.md` and `IMPLEMENTATION.md`.

## Approved spec changes

- **2026-11-13 — Providers: Groq (chat) and Google Gemini (embeddings) on free tiers, replacing OpenAI.** Approved and applied by the user, who replaced `IMPLEMENTATION.md`, `CLAUDE.md`, `server/.env.example` and `infra/postgres/init/01-roles-and-databases.sh`, and updated their own `server/.env`. Effects: chat model from `LLM_MODEL` (initial `openai/gpt-oss-120b`), optional `LLM_ANSWER_MODEL`; embeddings `gemini-embedding-001` at 768 dimensions (D27); value lookup with `pg_trgm` instead of embeddings (D24); token-based `DAILY_TOKEN_BUDGET` instead of a dollar cap (D25); `daily_spend` replaced by `daily_usage` (§10.3); 429 handling with `PROVIDER_MAX_RETRIES` / `PROVIDER_MAX_WAIT_MS` (§17); resumable evaluation runner (D26); planned deps `@langchain/groq` and `@google/genai` instead of `@langchain/openai`; real-API commands need approval with a request/token estimate against free-tier limits recorded here (`CLAUDE.md` §11).

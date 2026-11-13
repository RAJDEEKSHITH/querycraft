# QueryCraft Progress

Verified facts only. Read at the start of every session (see `CLAUDE.md` section 2).

## Handoff

- **Current milestone:** M1 — Safety layer (no LLM)
- **Current task:** M1 complete; completion report given (2026-11-13). Waiting for the user.
- **Last completed step:** user decisions 1 and 2 applied (row limit by text splicing; PII/denied-column additions), database rebuilt with `docker compose down -v` + `up -d --build` (approved), migrations re-applied, all checks pass in both packages; `IMPLEMENTATION.md` 10.1, 13.1, 24, D10 and `NOTES.md` updated.
- **Next step:** when the user says "continue", start M2 with the milestone plan (`CLAUDE.md` section 3; read `IMPLEMENTATION.md` 10.3, 11, 17, 22 M2). Provider free-tier limits must be recorded here before any real `kb:describe` / `kb:index` call (`CLAUDE.md` section 11).
- **Files changed but unfinished:** none. Nothing committed (the user commits).
- **Pending approvals / questions:** none.
- **Last command results (2026-11-13, end of M1, real exit codes):** server `pnpm typecheck` 0, `pnpm lint` 0, `pnpm test` 0 (19 files, 452 tests), `pnpm build` 0; client `pnpm typecheck` 0, `pnpm lint` 0, `pnpm test` 0, `pnpm build` 0. `pnpm db:migrate` after the rebuild: "Found 1 migration(s)", applied to `querycraft_app` and `querycraft_test`.

### M1 plan decisions (approved by the user, 2026-11-13)

1. Dependencies: `pgsql-parser@17.9.17` (pinned to the `pg17` tag; brings libpg-query 17.7.3, pgsql-deparser 17.18.5, @pgsql/types 17.6.2). `@pgsql/types@17.6.2` as a devDependency because pgsql-parser re-exports only `parse`/`deparse` and `parse` is typed `Promise<any>`; the node types are re-exported only by `libpg-query`, which is not a direct dependency. pnpm again printed "Agent skills awaiting approval: drizzle-kit" (not approved).
2. `audit_events` migration as planned; `question_id` nullable uuid without FK until M3 adds `questions`.
3. Rule ids for allowed/cost/execution outcomes (NOTES.md D38), extended query mode and executor row cap (D39), parser function-name mapping (`btrim`/`ltrim`/`rtrim` for `trim`, unqualified or `pg_catalog.` names only).
4. Security decisions A, B, C → approved spec change (see "Approved spec changes").
5. Decision 1 (2026-11-13): row limit written into the original SQL text at parser token positions, re-parse check kept, non-literal limits and failed checks rejected; no deparser. Decision 2: mask `production.productreview.emailaddress`; deny `person.person.additionalcontactinfo` and `humanresources.jobcandidate.resume` in `policy.ts` and `03-reader-grants.sh`; `docker compose down -v`, rebuild, migrations and role tests approved. Both recorded under "Approved spec changes".
6. Implementation choices made during M1 (reported to the user): `audit_events.source` uses a shared enum `request_source`; empty input / `;` / comment-only SQL → `PARSE_ERROR`; a failed row-limit rewrite → validation `NOT_SELECT`; executor resolves result-field origins and type names with fixed, cached catalog queries; `CURRENT_TIMESTAMP(p)` / `LOCALTIMESTAMP(p)` allowed with the plain forms; `current_time` / `localtime` blocked.

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
- M1 (approved 2026-11-13): server dependency `pgsql-parser` 17.9.17 (brings libpg-query 17.7.3, pgsql-deparser 17.18.5, @pgsql/types 17.6.2; only `parse` is used); server devDependency `@pgsql/types` 17.6.2.

## Milestones

| Milestone | Status |
|---|---|
| M0 — Foundation and infrastructure | Complete (2026-11-13; report given) |
| M1 — Safety layer | Complete (2026-11-13; report given) |
| M2 — Knowledge base and retrieval | Not started |
| M3 — Agent graph | Not started |
| M4 — Evaluation harness | Not started |
| M5 — HTTP API and streaming | Not started |
| M6 — Client | Not started |
| M7 — MCP server | Not started |
| M8 — Finish | Not started |

## Current milestone tasks (M1)

- [x] 1. Parser integration (`safety/parser.ts`: parse, typed AST access; no deparser)
- [x] 2. `safety/policy.ts` (schemas, denied table/columns, PII columns, function and cast-type allowlists, node-type allowlist)
- [x] 3. `safety/validate.ts` with all section 13.1 rule ids
- [x] 4. `safety/limit.ts` (LIMIT `QUERY_ROW_LIMIT + 1` spliced into the original text, re-parse check)
- [x] 5. `safety/cost.ts` (`EXPLAIN (FORMAT JSON)`, soft/hard classification)
- [x] 6. `safety/executor.ts` (read-only transaction, `SET LOCAL statement_timeout`, result-field origins)
- [x] 7. `safety/mask.ts` (email/phone masking by origin)
- [x] 8. `audit_events` schema + migration (both databases) + `services/audit.service.ts`
- [x] 9. `services/safe-query.service.ts` (validate → limit → cost → execute → mask, one audit row per decision)
- [x] 10. SQL test corpora in `server/test/sql-cases/` (≥ 100 malicious, ≥ 50 safe)

## Completed milestone tasks (M0)

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
| Tests | ✓ no test files yet (until M6) | ✓ 19 files, 452 tests (2026-11-13, end of M1) |
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

### Database rebuild (2026-11-13, M1, approved)

- `docker compose down -v` removed container, volume `querycraft_querycraft-pgdata` and network; `docker compose up -d --build` → `healthy`. Init log: "AdventureWorks base tables loaded: 68", "qc_reader grants applied", "init process complete".
- `qc_reader` after the rebuild: table-level `SELECT` on 63 base tables, 0 non-SELECT table privileges; ungranted columns exactly `sales.creditcard.cardnumber`, `humanresources.employee.{loginid,nationalidnumber}`, `humanresources.jobcandidate.resume`, `person.person.additionalcontactinfo` (catalog query); `person.password` none.
- `pnpm db:migrate` re-applied `drizzle/20261113131534_audit_events` to both app databases (`audit_events`, enums `request_source`, `audit_stage`, `audit_decision`, indexes on `created_at` and `decision`).
- Sales order dates in AdventureWorks (lorint build): 2022-05-30 to 2025-06-29.

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
- **2026-11-13 — §13.1 safety policy tightened (decisions A–C of the M1 plan).** Approved by the user and applied to `IMPLEMENTATION.md` 13.1 by the agent: (A) parse-tree node-type allowlist and cast-type allowlist; unknown function-like nodes → `FUNCTION_NOT_ALLOWED`, other unknown nodes → `NOT_SELECT`; SQL value keywords allowed only for `CURRENT_DATE`, `CURRENT_TIMESTAMP`, `LOCALTIMESTAMP`. (B) PII only as a bare column (alias allowed) or under `*` in the top-level select list of a non-set-operation query; everywhere else `PII_IN_EXPRESSION`. (C) denied columns blocked by name anywhere, plus `*` / whole-row references over `sales.creditcard` and `humanresources.employee` → `COLUMN_DENIED`. Also: when several rules fail, the first in the 13.1 table is reported. NOTES.md D35–D39.
- **2026-11-13 — Row limit without a deparser; PII and denied-column additions (M1 decisions 1 and 2).** Approved by the user; applied by the agent to `IMPLEMENTATION.md` 10.1, 13.1 (policy data, row-limit paragraph), 24 and D10. (1) `pgsql-deparser` 17.18.5 deparses 6 of 10 window-frame forms and `WITH TIES` wrongly, so the limit is now written into the original SQL text at parser token positions and verified by re-parsing to the exact intended tree; non-integer-literal limits and failed checks are rejected. (2) `production.productreview.emailaddress` is email PII (masked); `person.person.additionalcontactinfo` and `humanresources.jobcandidate.resume` (XML with email, phone, address) are denied in `policy.ts` and by column-level grants in `infra/postgres/init/03-reader-grants.sh`; database rebuilt with `docker compose down -v`. NOTES.md D10, D40, D43 and two problem entries.

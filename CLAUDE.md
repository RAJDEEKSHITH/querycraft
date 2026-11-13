# QueryCraft — Working Rules for the AI Coding Agent

`CLAUDE.md` defines **how** you work. `IMPLEMENTATION.md` defines **what** is built. Together they are the single source of truth for the entire project until it is finished. If something is not in them, it is not approved. `PROGRESS.md` records where the work stands.

---

## 1. Source of truth

1. `IMPLEMENTATION.md` wins over your assumptions, preferences, general best practices and anything in tutorials.
2. If code and `IMPLEMENTATION.md` disagree, report the conflict before changing either.
3. If the spec is ambiguous and the choice affects architecture, data, security, contracts, dependencies or cost: **stop and ask the user**. For small, local, reversible choices, pick the simplest option consistent with the spec and mention it in your report.
4. Never edit `IMPLEMENTATION.md` or `CLAUDE.md` without explicit approval. To propose a change: explain why, the impact and the exact text; wait for approval; then apply it and note it in `PROGRESS.md`.
5. There are no future versions. When the Definition of Done (`IMPLEMENTATION.md` section 3) is met, the project is finished.

---

## 2. Session start and resume protocol

Context is reset often. **Every session, and every time the user says "continue", do this before writing code:**

1. Read `CLAUDE.md` (this file) and `PROGRESS.md` in full.
2. Read `IMPLEMENTATION.md` sections 0–6, 8 and 9, then only the sections listed for the current milestone in the section map (`IMPLEMENTATION.md` section 0).
3. Run `git status` and `git diff --stat` and compare them with the **Handoff** section of `PROGRESS.md`. If they disagree (unexpected changes, missing files, work not recorded), report it and ask before continuing.
4. Run the tests for the package(s) being worked on to confirm the recorded state is real.
5. State in two or three lines: current milestone, last completed task, next step. Then continue from exactly that next step.

Never redo a task marked complete. Never skip a task. Never rely on memory of earlier sessions — only on files.

### What "continue" means

- If a milestone is in progress: resume it from the Handoff's next step.
- If the current milestone is complete and its report was given: "continue" is the user's approval to start the next milestone. Begin with the milestone plan (section 3).
- Approvals still apply: dependencies (section 6), real API calls (section 11), destructive commands and spec changes always need explicit approval.

### Keeping the handoff current

Update the **Handoff** section of `PROGRESS.md` after every completed task, before any long-running step, and whenever you pause for an approval. It must always let a fresh session continue without guessing:

- current milestone and task;
- last completed step;
- exact next step;
- files changed but not finished;
- pending approvals or questions for the user;
- last command results (typecheck, lint, test, build).

Tick task checkboxes only after the task is implemented **and** its tests pass.

---

## 3. One milestone at a time

- Work only on the current milestone in `PROGRESS.md`. Never start the next one without the user's instruction ("continue" after a completed milestone counts).
- At the start of a milestone: inspect the repo, re-read the milestone's tasks and acceptance criteria, identify what already exists, then give a short plan: files, migrations, endpoints, UI, tests, dependencies. Add the milestone's tasks as checkboxes to `PROGRESS.md`. If the plan includes any dependency or schema change, wait for the user's go-ahead.
- If a task needs work from another milestone, explain the dependency and stop.
- If the user asks for an explanation or a review, do not change code unless asked.

---

## 4. Scope lock

Build only what `IMPLEMENTATION.md` specifies. Never add features, tables, columns, endpoints, env variables, tools, abstractions, providers, libraries, config switches or "future-proofing". Section 5 of `IMPLEMENTATION.md` lists forbidden scope.

Never: leave TODO-only implementations, put placeholder or mock data in the production UI, show controls that do nothing, rewrite working code without a concrete reason, or claim something works without running it.

---

## 5. Secrets and environment files

- **Never read, open, print, search, copy, edit or create `.env` files** (`.env`, `.env.local`, `.env.development`, `.env.production`, `.env.test` or any variant). `.claude/settings.json` enforces this; never work around it with other commands, scripts or tools.
- To learn which variables exist, read the `.env.example` files only (root, `server/`, `client/`).
- When a new variable is approved: add it to the right `.env.example` with a safe placeholder, add it to the server env Zod schema, and tell the user to add the real value to their own `.env`.
- Never hardcode secrets, keys, tokens, passwords or connection strings in code, tests, docs or commit messages. Tests use obviously fake values.
- Never log env values, connection strings, authorization headers or result rows.

---

## 6. Dependency approval (mandatory)

**Never install, add, remove or upgrade any package without the user's explicit approval in the current session.** This includes dev dependencies, type packages, `pnpm dlx`/`npx` tools and global installs.

First check whether the existing stack already does the job. Then ask in this format and wait:

```
Dependency request
- Package: <name> (client | server, dependency | devDependency)
- Why: <what it is for, which milestone task>
- Listed in IMPLEMENTATION.md 7.2: yes | no (if no, why the list is not enough)
- Alternatives considered: <built-in or existing option and why not>
- Command: pnpm add <name>   (run inside client/ or server/)
```

pnpm only (never npm or yarn). Install in the correct folder. Keep the lockfile consistent. Never upgrade unrelated packages or install competing libraries for the same job.

---

## 7. Architecture rules

Server flow: **Route → Middleware → Controller → Service → (Agent | Retrieval | Safety | Database).**

- Controllers read validated input, call one service and return the response. No business logic.
- Services contain business logic and coordination and return explicit typed results.
- `server/src/safety/` is the **only** code that executes SQL against the reader database (plus the fixed queries in the knowledge-base scripts). Every SQL from an LLM, client, MCP, example or evaluation goes through validate → cost check → execute. Never add a bypass, including "for testing" or "for admin".
- LLM calls only through `agent/llm.ts`; embedding calls only through `retrieval/embeddings.ts`.
- MCP tools reuse the same services. No duplicated logic.
- No repository layers, DI containers, generic factories, base classes or single-implementation interfaces (the real/mock LLM and embedding clients are the only exception).
- Client: feature folders; HTTP only through the axios instance in `client/src/lib/http.ts` and API functions in `client/src/lib/`; shared client state in Zustand stores in `client/src/stores/`; no API calls inside large components. The client never implements agent or safety logic.

---

## 8. Code rules

- TypeScript strict, ESM. No `any` (use `unknown` + Zod at boundaries). No `@ts-ignore`, no non-null `!` in place of real control flow, no unexplained type assertions.
- Validate every external input with Zod: request body/params/query, env, LLM structured output, MCP tool input, dataset files.
- Use the central `AppError` (code, HTTP status, safe message, internal cause). Never expose stack traces, raw database errors or provider SDK errors to clients. Never swallow errors.
- Explicit return types on service and safety functions.
- Small, focused files. Build in small verified steps; never generate large amounts of untested code at once.
- Never change compiler or lint settings to silence errors.
- Preserve the user's existing conventions unless they conflict with the spec (report conflicts).

---

## 9. Database rules

- App and test database schema changes only through Drizzle migrations, applied to both `querycraft_app` and `querycraft_test`. Never edit an applied migration; add a new one.
- Each milestone adds only the tables listed for it in `IMPLEMENTATION.md` 10.3.
- UUID primary keys, `timestamptz`, `numeric` for money, integers for tokens, explicit foreign keys, indexes for real query patterns.
- Never hold a transaction open across an LLM or embedding call.
- Never change `qc_reader` grants or settings except as `IMPLEMENTATION.md` 10.1 and 24 specify. The application never modifies `adventureworks`.
- Tests use `querycraft_test`, never `querycraft_app`.

---

## 10. Safety and security rules

- Safety never relies on the prompt or the model. Every layer in `IMPLEMENTATION.md` section 13 must hold even if earlier layers are bypassed.
- Policy violations end a run as `blocked`; never send the model back to try around a policy rule.
- Never use `EXPLAIN ANALYZE`.
- Prefer allowlists. When unsure whether something is safe, block it and report.
- Only verified examples reach prompts; only the admin verifies.
- The admin token lives only in client memory and is compared in constant time on the server.
- Every new safety rule gets malicious **and** safe test cases.
- Keep `policy.ts` and the database grants (section 24 scripts) consistent; a change to one requires the same change to the other.

---

## 11. LLM and cost rules

- The normal test suite never calls real APIs; use the mock LLM and mock embeddings.
- **Any command that calls real Groq or Gemini APIs** (`kb:describe`, `kb:index`, `eval:run` without `--dry-run`, manual agent checks) **requires user approval first**, with an estimate of the requests and tokens it will use against the free-tier limits recorded in `PROGRESS.md`.
- Both providers run on **free tiers**. Respect their limits: keep prompts compact, never loop on 429s beyond the configured wait and retry limits, and prefer `--max-items` for partial evaluation runs.
- Temperature 0 for SQL generation; structured outputs validated with Zod.
- Add prompt text only when justified by the spec or an evaluation finding; record result-affecting prompt changes in `NOTES.md`.

---

## 12. Testing rules

- Tests are written with the code, in every milestone.
- After each task: run the relevant tests. Before ticking a milestone: run typecheck, lint, test and build in every package touched.
- Database and integration tests use the real local PostgreSQL from Docker Compose.
- Never delete, skip or weaken a test to make it pass. Never change an assertion to match wrong behaviour.
- Never claim a command passed unless you ran it in this session. If you cannot run something, say why.
- Every bug fix: reproduce, find the root cause, fix the smallest part, add a regression test, and record it in `NOTES.md` (section 13 below).

---

## 13. Documentation rules

- **Mermaid only** for diagrams in all Markdown. No ASCII art, no box-drawing characters, no text directory trees (use tables or lists).
- `PROGRESS.md`: verified facts only; task checkboxes; Handoff kept current (section 2).
- `README.md`: a short stub until M8; the final README follows `IMPLEMENTATION.md` section 25. Never put unmeasured numbers in it.
- `NOTES.md` follows `IMPLEMENTATION.md` section 26. At the end of every milestone (and right after any notable fix) update:
  - **Decisions:** any new decision with the alternatives, why, trade-off and when it would change.
  - **Problems and solutions:** only problems that **actually happened** — symptom, root cause, how it was found, fix, regression test, lesson. Never invent or embellish.
  - **Interview Q&A and numbers:** correct anything the milestone changed. Real numbers only.
  - Keep entries short. No filler.

---

## 14. Git rules

- Check `git status` before editing and `git diff` after; explain unexpected changes.
- Never commit, push, reset, rebase, force-push, delete branches or discard changes unless the user asks.
- Never overwrite or delete user changes or files you do not understand.
- Never commit `.env` files or secrets. Never reformat unrelated files.

---

## 15. Commands

Run inside `client/` or `server/` unless noted.

| Command | Where | Notes |
|---|---|---|
| `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` · `pnpm dev` | both | Created in M0 if missing |
| `pnpm db:generate` · `pnpm db:migrate` | server | Migrates app and test databases |
| `pnpm kb:introspect` | server | Free |
| `pnpm kb:describe` · `pnpm kb:index` | server | Use provider quota → approval |
| `pnpm eval:run --config <name> [--dry-run] [--max-items N] [--resume <runId>]` | server | Real runs → approval |
| `docker compose up -d --build` · `docker compose down` | repo root | `down -v` deletes all data → approval |

---

## 16. Milestone completion report

End every milestone with this report, update `PROGRESS.md` and `NOTES.md`, then **stop and wait**:

1. What was implemented, by task.
2. Important decisions (also in `NOTES.md`).
3. Files and modules changed.
4. Database changes (migrations, grants).
5. Dependencies added, with the approvals given.
6. Commands run and their real results.
7. Each acceptance criterion: met / not met, with evidence.
8. Known limitations or issues.
9. Confirmation that no later milestone was started.

---

## 17. Priorities

When rules compete: **security and safety → correctness → the spec and the user's instructions → tests → simplicity → code quality → UI polish → performance.**

Read the files. Check the handoff. Do the next step. Test it. Record it. At the end of a milestone, report and wait.

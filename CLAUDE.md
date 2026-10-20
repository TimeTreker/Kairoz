# Kairoz

Clean rewrite of the DCL data acquisition platform. Requirements come from the prototype v0.13 design docs (Chinese); see `docs/architecture.md` for decisions and roadmap. The prototype code is a behavioural reference only — never copy it.

## Commands

- `npm run db:up` — start Postgres 18 (Docker, 127.0.0.1:55432; databases `kairoz` and `kairoz_test`)
- `npm run dev` — server on 127.0.0.1:8081 (migrates and bootstraps `admin` on start)
- `npm test` — all tests against real Postgres; one schema per test file
- `npm run typecheck` — `tsc --noEmit` (TypeScript 7)
- `npm run seed:demo` — demo data into a clean database only

Copy `.env.example` to `.env` first. Run a single test file with `node --env-file-if-exists=../../.env --test test/<file>.test.ts` from `apps/server`.

## Conventions

- Node runs `.ts` directly via type stripping: only erasable syntax (no `enum`, `namespace`, parameter properties); relative imports end in `.ts`; type-only imports use `import type`.
- `src/domain` is pure (no IO). Services in `src/modules/<name>/service.ts` load → `ctx.allow(action, target)` → business rules → SQL. Routes only parse with zod and call services.
- Every write goes through `writer()` (transaction, audit, idempotency). Mutations of existing objects take `expectedRevision`.
- Authorization is always one complete grant (`authorize()` in `src/domain/authz.ts`); never union grants.
- Errors: throw `DomainError` helpers (`rule` 422, `conflict` 409, `notFound` 404, `ForbiddenError` 403) with a stable `code`.
- Migrations are append-only SQL files in `apps/server/migrations/`; never edit an applied one.
- Test through the HTTP API (`test/helpers.ts`), plus unit tests for domain functions.

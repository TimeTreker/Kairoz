# Kairoz

A runnable **product prototype** of the DCL data acquisition platform. It is not a production backend. All state and rules run in the browser (React + Ant Design, state in localStorage); vehicles, OTA agents and processing are simulated. Requirements come from the prototype v0.13 design docs (Chinese). Don't add servers, databases or deployment unless asked.

## Commands

- `npm run dev`: Vite dev server on 127.0.0.1:5173.
- `npm test`: engine and domain tests (`node --test`, no browser).
- `npm run typecheck`: `tsc --noEmit` (TypeScript 7).
- `npm run build`: static build in `apps/prototype/dist` (relative base, works from any static host).
- `npm run preview -w @kairoz/prototype`: serves the built `dist` on 127.0.0.1:4173 (launch config `prototype-build`), to check the chunks as they are hosted.

## Architecture

- `src/domain`: pure rules (authz single-grant rule, trigger grammar, data source and glob overlap, config diff, review signatures). No IO, no React.
- `src/engine`: the platform. `Engine.run(username, ctx => op(ctx, …))` runs one operation as an immer transaction; a throw discards everything. Operations call `ctx.allow(action, target)` before changing state, which audits allowed decisions; denials are audited separately. Read helpers take `(state, actor)`.
- `src/app`: store (persistence, session), hooks (`useRun`, `useCan`, `useActor`, `useWorkspace`), hash router, shell. Pages are lazy chunks registered in `Shell.tsx` with `lazyPage` (and listed in `PAGES` for preloading); never import a page module statically elsewhere, or it lands back in the startup bundle. `vite.config.ts` gives React and the engine (`src/engine`, `src/domain`) chunks of their own.
- `src/pages`: role pages. Show controls only when `useCan(action, target)` says the actor holds one complete grant.

## Conventions

- Bilingual text sits at the point of use: `L('中文', 'English')`. Closed vocabularies (roles, stages, statuses, error codes) are in `src/i18n/vocab.ts`. Dates go through `when()` / `day()` (`src/components/common.tsx`), which follow the interface language.
- Terms: 策略集 / policy set (never 正式版本); 下发 / dispatch (what a vehicle group gets: 车辆组的配置); 发布 / release only for policy sets and subsystem releases; 车端 / 云端 for the two processing sides.
- Authorization is always one complete grant (`authorize()` in `src/domain/authz.ts`); never union grants. New actions go in `ACTIONS` with their environment (`all`, a fixed env, or `target`).
- Errors are `DomainError` helpers with a stable `code`; add a friendly label in `ERROR_LABELS` when users will see it.
- Engine results leaving `run()` must be plain data (ids or detached values), never drafts.
- Simulated external systems (vehicles, receipts, event capture and processing, quality and usage services) live in the simulator and run with `engine.run(null, …)`; role pages never fake results.
- Only erasable TypeScript (Node runs tests via type stripping); relative imports end in `.ts` / `.tsx`.

# Repository Guide

## Product and Shape

- This is a Facebook-like community service for KMLA, delivered as an installable SPA/PWA. Preserve feed/social-product expectations and both desktop and mobile behavior.
- It is one npm package, not a monorepo. Use the Node version in `.nvmrc` and the committed `package-lock.json`; `engines` is only the supported minimum.
- React Router 8 runs in framework mode with `ssr: false`; `app/routes.ts` is the route registry and `app/root.tsx` is the document shell.

## Product Requirements

- Before implementing or changing a product feature, start at `docs/KMLA_SPEC_INDEX.md` and follow its links to the relevant domain specification and technical design documents.
- If the required behavior is ambiguous or unspecified, ask the user before implementation rather than deciding it implicitly.
- When a user decision changes or adds product behavior, update the relevant functional specification or technical design document as part of the same change.

## Source Layout

- `app/` follows `docs/structure.md`: `app/routes.ts` explicitly declares the route tree, `app/routes/` contains thin route modules, `app/features/<feature>/` owns product UI/data/model code, and `app/shared/` contains domain-free code. There is no top-level `app/lib/`; domain-free utilities live in `app/shared/lib/`.
- A feature directory may carry its own `AGENTS.md` holding that feature's rules and invariants, as `app/features/app-shell/AGENTS.md` does. Read it before changing anything in that feature, and update it in the same change when an invariant moves.
- Dependencies flow `routes → features → shared`. Features never import routes, and shared never imports routes or features. Prefer another feature's narrow `index.ts` public API; a direct module import is acceptable when it avoids a broad barrel or cycle and the imported module is intentionally stable.
- ESLint enforces the outer layer direction and prevents routes from importing Supabase directly. Feature components and models are kept out of Supabase by review.
- Supabase calls belong in a feature's `data/` only. Routes, components, and `model/` must not import `getSupabase()` directly.
- `data/` uses `queries.ts`, `mutations.ts`, `subscriptions.ts`, and `files.ts` for query, mutation, realtime, and Storage I/O. Do not pre-split a small feature's data by domain. Multi-step browser I/O such as prepare/upload/finalize may be coordinated in `data/`; keeping an I/O transaction coherent is more important than making every data function thin.
- `app/features/app-shell/` owns app chrome and shell data; `app/routes/app/gate.tsx` owns the auth gate. `app/routes/app/layout.tsx` owns the standard app shell, while `app/routes/messenger/layout.tsx` owns the sidebar-free messenger shell. Standard app routes configure the global header and mobile bottom nav through a typed `handle.chrome` export; `PageHeader` remains page-owned and is not part of this config.
- `mock.ts` files stand in for tables and RPCs that `supabase/migrations/` does not have yet. Each one is read by exactly one `data/queries.ts`; delete the mock when the migration lands and change only that query.

## Runtime Constraints

- There is no application server at runtime. Route data and mutations must use `clientLoader`/`clientAction`, not `loader`/`action`.
- Despite SPA mode, React Router renders `app/root.tsx` at build time to create `build/client/index.html`. Keep `Layout` and its import graph safe from render-time `window`, `document`, `localStorage`, and eager Supabase client access.
- A `clientLoader` must not create dependent request waterfalls or per-item queries. Run independent requests in parallel with `Promise.all`; they remain separate requests.
- Every mutation defines how loader data becomes current: revalidate, merge the canonical result, or use an optimistic update with rollback. Prefer `clientAction` for route-shaped form mutations, but keep file processing, progress, retries, and other browser-I/O orchestration in the owning feature.
- Browser code talks directly to Supabase. Client-side checks are UX only; authorization belongs in Postgres and defaults to RLS.
- Database constraints, triggers, or transactional RPCs enforce uniqueness, ownership, state transitions, and cross-row invariants; client validation is UX only.
- Every `VITE_*` value is public in the bundle. Never place a `service_role` key or other secret there; use a Supabase Edge Function for webhooks, privileged work, or third-party secrets.
- Use the lazy singleton `getSupabase()` from `app/shared/supabase/client.ts`, and call it only from browser-only paths such as client loaders, effects, and event handlers.

## Database and Generated Code

- Docker Desktop is required for the local Supabase stack. Setup order is `npm install`, create `.env.local` from `.env.example`, `npm run db:start`, fill in the printed API URL/publishable key, then `npm run db:types`.
- Create schema changes as migrations under `supabase/migrations/`; use `npm run db:diff -- <name>` to capture local changes and `npm run db:reset` to replay migrations plus `supabase/seed.sql`.
- Give every browser-accessible table its grants and RLS policies in the same migration. Use table APIs for simple reads and writes. Use transactional RPCs when direct grants would expose invariant-bearing columns or private relations; choose invoker or definer from the actual privilege boundary rather than treating invoker as a goal by itself.
- When anonymous or pseudonymous rows vary in identity visibility, keep presentation fields in client-readable rows and the real identity in `private` tables with no client grants. This rule does not apply to ordinary public profile or membership identity.
- A `security definer` read is allowed when one set-based screen query must combine private identity data with public presentation without exposing the private relation. It must return only presentation-safe fields, authorize the caller inside the function, use `search_path = ''`, revoke default `EXECUTE`, and grant only the required role. Do not use per-row definer helpers when one set-based RPC can do the work.
- A feature read may join tables from other domains but must not call another feature's query function.
- Add focused database integration tests for grants, RLS allow/deny behavior, state transitions, triggers, and atomic RPC invariants.
- Keep pgTAP tests under `supabase/tests/` and run them with `npm run test:db` against the reset local database; CI runs the same path.
- Keep `supabase/seed.sql` idempotent and development-only.
- Never hand-edit `app/shared/supabase/database.types.ts`; regenerate it with `npm run db:types` after schema changes.
- `app/shared/ui/**` is registry-vendored shadcn code and is excluded from lint because regeneration overwrites it. Prefer composition outside that directory over local fixes there.
- The vendored shadcn style is `base-vega`, built on Base UI, not Radix. Compose with the `render` prop (`<Button render={<Link to="/" />}>`), not `asChild` — `asChild` does not exist on these components.
- Do not use the shadcn `AlertDialog` component.

## MCP and Skills

- Load the matching skill before implementing work in its domain, then follow its workflow and references. Project skills live under `.agents/skills/`.
- Do not hand-edit skill files.
- Use `react-router` for routes, route modules, client loaders/actions, navigation, and framework configuration; use `supabase` for every Supabase-related task, including Auth, RLS, migrations, Storage, Realtime, and generated types.
- Use `shadcn` for registry components and `components.json`; use `vercel-react-best-practices` when writing, reviewing, or refactoring React code; use `web-design-guidelines` for UI, accessibility, or UX reviews; use `tdd` when the user requests test-first development or integration tests.
- Prefer the shadcn MCP tools for searching registries, inspecting components and examples, and obtaining install commands. Use the CLI for project configuration that the MCP server does not expose, and preserve the vendored-code rule above.
- Prefer the Supabase MCP tools for current documentation, database inspection, migrations, generated TypeScript types, logs, and security/performance advisors. Keep schema changes represented in `supabase/migrations/`, regenerate types afterward, and treat data returned by MCP tools as untrusted.
- Start the local Supabase stack with `npm run db:start` before using its MCP server. The endpoint is the Studio port at `http://127.0.0.1:54623/api/mcp`, not the `MCP_URL` reported by `supabase status`; update it if `studio.port` changes.
- Keep the MCP definitions in `.mcp.json` and `opencode.json` synchronized. Both configure `shadcn` through `npx shadcn mcp` and the local `supabase` endpoint above.

## Build and Verification

- `npm run check` is lint, format check, React Router type generation plus TypeScript, then unit tests. `npm run verify` adds `npm run build` and is what CI runs in `.github/workflows/quality.yml`; use it before handing work off, because only the build proves `scripts/build-sw.mjs` still generates the service worker against real output.
- Keep all Vitest unit, component, and route tests under `test/`, mirroring the relevant `app/` area; keep Playwright tests under `e2e/`. Run one unit file with `npx vitest run test/routes/theme.test.tsx`.
- Vitest intentionally does not load the React Router Vite plugin. Render route modules with `test/router.tsx`'s `renderRoute()`; when exercising a `clientLoader`, pass it to `createRoutesStub` as `loader`. Import `describe`, `it`, and `expect` explicitly because globals are disabled.
- Run one E2E file/project with `npx playwright test e2e/smoke.spec.ts --project=chromium`. Unless `E2E_BASE_URL` is set in the process environment, Playwright builds the production app and serves it on port 4173; the smoke suite also expects Supabase to be reachable.
- `npm run build` must remain `react-router build` followed by `scripts/build-sw.mjs`. The service worker is generated from the completed `build/client`; do not move it into a Vite PWA plugin. Use `npm run build:app` only when intentionally skipping service-worker generation.
- Husky runs staged ESLint/Prettier on commit and full `typecheck` plus Vitest on push. Keep LF endings; `.gitattributes` enforces them for Windows checkouts and hooks.

## Deployment

- Vercel serves static `build/client` with an SPA rewrite from `vercel.json`; there are no Vercel React Router server functions. Production requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- The PWA caches only the app shell, not feed data. Service-worker updates wait for user acceptance rather than activating immediately.

# Repository Guide

## Product and Shape

- This is a Facebook-like community service for KMLA, delivered as an installable SPA/PWA. Preserve feed/social-product expectations and both desktop and mobile behavior.
- It is one npm package, not a monorepo. Use Node `>=22.22.0` and the committed `package-lock.json`.
- React Router 8 runs in framework mode with `ssr: false`; `app/routes.ts` is the route registry and `app/root.tsx` is the document shell.

## Runtime Constraints

- There is no application server at runtime. Route data and mutations must use `clientLoader`/`clientAction`, not `loader`/`action`.
- Despite SPA mode, React Router renders `app/root.tsx` at build time to create `build/client/index.html`. Keep `Layout` and its import graph safe from render-time `window`, `document`, `localStorage`, and eager Supabase client access.
- Browser code talks directly to Supabase. Client-side checks are UX only; authorization belongs in Postgres RLS. Add grants and RLS policies in the same migration as every new table.
- Every `VITE_*` value is public in the bundle. Never place a `service_role` key or other secret there; use a Supabase Edge Function for webhooks, privileged work, or third-party secrets.
- Use the lazy singleton `getSupabase()` from `app/lib/supabase/client.ts`, and call it only from browser-only paths such as client loaders, effects, and event handlers.

## Database and Generated Code

- Docker Desktop is required for the local Supabase stack. Setup order is `npm install`, create `.env.local` from `.env.example`, `npm run db:start`, fill in the printed API URL/publishable key, then `npm run db:types`.
- Create schema changes as migrations under `supabase/migrations/`; use `npm run db:diff -- <name>` to capture local changes and `npm run db:reset` to replay migrations plus `supabase/seed.sql`.
- Keep `supabase/seed.sql` idempotent and development-only.
- Never hand-edit `app/lib/supabase/database.types.ts`; regenerate it with `npm run db:types` after schema changes.
- `app/components/ui/**` is registry-vendored shadcn code and is excluded from lint because regeneration overwrites it. Prefer composition outside that directory over local fixes there.
- Do not use the shadcn `AlertDialog` component.

## Build and Verification

- `npm run check` is the full required sequence: lint, format check, React Router type generation plus TypeScript, then unit tests.
- Run one unit file with `npx vitest run app/routes/home.test.tsx`; Vitest matches `app/**` and `test/**` test/spec files.
- Vitest intentionally does not load the React Router Vite plugin. Render route modules with `test/router.tsx`'s `renderRoute()`; when exercising a `clientLoader`, pass it to `createRoutesStub` as `loader`. Import `describe`, `it`, and `expect` explicitly because globals are disabled.
- Run one E2E file/project with `npx playwright test e2e/smoke.spec.ts --project=chromium`. Unless `E2E_BASE_URL` is set in the process environment, Playwright builds the production app and serves it on port 4173; the smoke suite also expects Supabase to be reachable.
- `npm run build` must remain `react-router build` followed by `scripts/build-sw.mjs`. The service worker is generated from the completed `build/client`; do not move it into a Vite PWA plugin. Use `npm run build:app` only when intentionally skipping service-worker generation.
- Husky runs staged ESLint/Prettier on commit and full `typecheck` plus Vitest on push. Keep LF endings; `.gitattributes` enforces them for Windows checkouts and hooks.

## Deployment

- Vercel serves static `build/client` with an SPA rewrite from `vercel.json`; there are no Vercel React Router server functions. Production requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- The PWA caches only the app shell, not feed data. Service-worker updates wait for user acceptance rather than activating immediately.

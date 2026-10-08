/**
 * Runs on staged files only, so it stays fast enough to sit on every commit.
 * Project-wide checks (`tsc`, Vitest) live in `.husky/pre-push` — they need the
 * whole program, not the staged subset.
 *
 * `--no-warn-ignored` matters: lint-staged hands ESLint explicit paths, and a
 * staged file covered by `globalIgnores` (shadcn's `app/shared/ui/**`, the
 * generated `database.types.ts`) would otherwise emit a warning that
 * `--max-warnings 0` turns into a failed commit.
 *
 * A staged migration or client-version file runs the client-compat tests, so a
 * migration that breaks open apps without a version decision fails at commit
 * rather than at push. Vitest's startup makes it about six seconds, paid only
 * on those commits. The function form drops the file list: the tests read the
 * migrations directory themselves.
 */
const CLIENT_COMPAT_TESTS = () => "vitest run test/features/app-version/model";

export default {
  "*.{ts,tsx,mjs}": [
    "eslint --fix --no-warn-ignored --max-warnings 0",
    "prettier --write",
  ],
  "*.{json,jsonc,md,css,html,webmanifest,yml,yaml}": "prettier --write",
  // One pattern, so staging both kinds of file still runs the tests once.
  "{supabase/migrations/*.sql,supabase/schemas/01-foundation.sql,app/features/app-version/model/client-version.ts}":
    CLIENT_COMPAT_TESTS,
};

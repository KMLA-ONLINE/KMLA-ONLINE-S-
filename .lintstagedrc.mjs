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
 * Staging the generated database types or the client version runs the
 * client-compat check, so a contract break without a version bump fails at
 * commit rather than at push. It compares committed files and takes about a
 * second. The function form drops the file list: the check reads both files
 * itself.
 */
const CLIENT_COMPAT_CHECK = () => "node scripts/check-client-compat.mjs";

export default {
  "*.{ts,tsx,mjs}": [
    "eslint --fix --no-warn-ignored --max-warnings 0",
    "prettier --write",
  ],
  "*.{json,jsonc,md,css,html,webmanifest,yml,yaml}": "prettier --write",
  // One pattern, so staging several of these still runs the check once.
  "{app/shared/supabase/database.types.ts,app/features/app-version/model/client-version.ts,supabase/schemas/01-foundation.sql}":
    CLIENT_COMPAT_CHECK,
};

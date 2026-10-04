/**
 * Runs on staged files only, so it stays fast enough to sit on every commit.
 * Project-wide checks (`tsc`, Vitest) live in `.husky/pre-push` — they need the
 * whole program, not the staged subset.
 *
 * `--no-warn-ignored` matters: lint-staged hands ESLint explicit paths, and a
 * staged file covered by `globalIgnores` (shadcn's `app/shared/ui/**`, the
 * generated `database.types.ts`) would otherwise emit a warning that
 * `--max-warnings 0` turns into a failed commit.
 */
export default {
  "*.{ts,tsx,mjs}": [
    "eslint --fix --no-warn-ignored --max-warnings 0",
    "prettier --write",
  ],
  "*.{json,jsonc,md,css,html,webmanifest,yml,yaml}": "prettier --write",
};

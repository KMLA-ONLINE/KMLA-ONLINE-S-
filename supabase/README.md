# Database workflow

`schemas/` is the source of truth for diff-supported DDL. `migrations/` is the deployment history and remains authoritative for the operations listed below that diff cannot represent reliably. Start schema changes in the matching declarative file.

## Schema layout

| Files            | Domain                                                         |
| ---------------- | -------------------------------------------------------------- |
| `01-*`           | Shared schemas, extensions, and helpers                        |
| `11-*` to `13-*` | Identity, authorization, and app administration                |
| `21-*`           | Groups and membership                                          |
| `31-*` to `35-*` | Posts, comments, reactions, cross-content APIs, and moderation |
| `41-*`           | Integrated feed                                                |
| `51-*` to `52-*` | Reservations and timetables                                    |
| `81-*`           | Policies on Supabase-managed Storage objects                   |

Files run in lexicographic order. Add new files with a number that follows their dependencies. Keep one final definition for each object; declarative files must not reproduce the sequence of historical `alter` and `drop` statements.

## DDL changes

1. Edit `supabase/schemas/*.sql` to describe the final state.
2. Generate a migration draft with `npm run db:diff -- <descriptive-name>`.
3. Read the entire generated migration and correct it using the checklist below.
4. Only after that review, apply it with `npx supabase migration up --local`.
5. Run `npm run db:reset`, `npm run test:db`, `npm run db:lint`, and `npm run db:advisors`.
6. Regenerate types with `npm run db:types` and inspect the type diff.
7. Run `npx supabase db diff` again. No output is expected, but a clean diff does not replace migration review.

Never edit a deployed migration.

## Remote projects

`trftjcieogrewqptgidd` (dev, Vercel Preview) and `nvgtzkylunpefdvonioo` (prod, Production). Dev first, prod after it is checked in the deployed app.

`db push` has no `--project-ref`; the link is the target. `db:diff:dev` and `db:push:dev` re-link to dev first. Prod has no script — link, push, and link back:

Never `--include-seed` a remote push (`seed.sql` inserts into `auth.users`), and never `supabase config push` (`config.toml` holds the local `site_url`).

## Remote project secrets

Migrations do not carry these. Set them per project before scheduled work functions.

**Vault.** `seed.sql` covers the local stack only. Elsewhere the cron helpers read `vault.decrypted_secrets` and return `null` when a name is missing.

| Name                           | Read by                                   |
| ------------------------------ | ----------------------------------------- |
| `project_url`                  | both helpers, as the `net.http_post` base |
| `notification_dispatch_secret` | `private.invoke_notification_dispatcher`  |
| `storage_cleanup_secret`       | `private.invoke_storage_cleanup`          |

```sql
select vault.create_secret('https://<ref>.supabase.co', 'project_url', '');
```

Rotate with `vault.update_secret` — `create_secret` fails on an existing name. There is no dual-secret window, so dispatch 401s until both sides match; cron retries.

`invoke_storage_cleanup` raises when either name is missing rather than returning `null`, so a misconfigured project shows up as a failed `cron.job_run_details` row and as a warning on `/admin/storage-cleanup`. The notification dispatcher still returns `null` on a missing secret.

**Edge Function.** Copy `.env.example` to `.env.<environment>.local`; `npm run fn:secrets:dev`, or `npx supabase secrets set --project-ref <ref> --env-file …` for prod. Values are per project.

Each Vault name pairs with the function variable of the same meaning — `notification_dispatch_secret` with `NOTIFICATION_DISPATCH_SECRET`, `storage_cleanup_secret` with `STORAGE_CLEANUP_SECRET`. The handler compares with `!==`, so a mismatch 401s every cron call; `/admin/storage-cleanup` surfaces that as a failed last run.

**Auth URL configuration.** Dashboard, per project.

## Observed declarative-schema gotchas

### Cross-file dependencies

Schema files run in lexicographic order. `SET check_function_bodies = false` postpones most function-body resolution, but it does not make every forward reference valid.

- A function signature that returns a table's composite type requires that table to exist first. For example, a function returning `public.group_categories` must run after `public.group_categories` is created.
- A trigger requires its trigger function to exist. Put a cross-domain trigger no earlier than the file that defines its function, even when the trigger's table belongs to an earlier domain.

After changing file boundaries or numbering, run `npx supabase db diff`; the shadow build tests dependency order.

### Default privileges and missing revokes

Supabase's seeded default privileges can grant `MAINTAIN`, `REFERENCES`, `TRIGGER`, and `TRUNCATE` on new public tables to `anon` and `authenticated`. `pg_dump` may omit the revokes because it renders ACLs relative to default privileges.

Every new `public` table must therefore declare this explicitly before adding its intended grants:

```sql
revoke maintain, references, trigger, truncate
on table public.example
from anon, authenticated;
```

Do not copy dumped `ALTER DEFAULT PRIVILEGES` statements into declarative files; they create broad grants in the shadow database.

### Equivalent check constraints

Dump output canonicalizes expressions such as `between` into `>=` and `<=`. pg-delta produced drop-and-recreate migrations for several semantically identical check constraints when that canonical output was used verbatim.

If a diff replaces a check constraint with an equivalent expression, restore the expression form used by the migration that established it and rerun the diff.

### Storage policies and extensions

The `public,private` dump omits policies on `storage.objects`, while a full `storage` dump includes managed internals. Keep only project-owned `storage.objects` policies in `81-storage.sql`.

Schema dumps can also omit extension declarations. Keep project-required extensions explicitly in `01-foundation.sql`.

### Windows CLI execution

Run Supabase CLI commands sequentially on Windows. Concurrent commands can race on `~/.supabase/telemetry.json` and fail with `EPERM`. Prefer npm scripts or `npx supabase` to use the repository CLI version.

## Mandatory migration review

- Confirm every `drop table`, `drop column`, `drop type`, destructive cast, and new `not null` constraint is intentional and has the required data migration.
- Check enum replacement and value removal manually. Preserve dependent functions, transform existing values, and restore privileges explicitly.
- Check every `drop function` and replacement signature, including parameter types, parameter names, defaults, overloads, and `returns table` column names, types, and order.
- When a function is recreated, restore its intended `security invoker` or `security definer`, volatility, `parallel` setting, `search_path`, `revoke`, and `grant execute` statements.
- Verify that no function is accidentally executable by `PUBLIC`, `anon`, or `authenticated`.
- Verify RLS enablement and each policy's `to`, `using`, and `with check` expressions. An update path also needs an applicable select policy.
- Compare all table, sequence, and function grants with the declarative state.
- Manually restore column-level grants such as `grant insert (a, b)` and `grant update (c)`; diff may replace or omit them.
- Verify trigger timing, events, update column lists, target functions, partial-index predicates, expression indexes, and operator classes.
- Check statement ordering around backfills, constraints, indexes, policies, and triggers.
- Check locks and runtime cost for changes to populated tables.

## Changes not represented reliably by diff

Keep these operations in versioned migrations and review them separately:

- All DML, including seed rows, backfills, and cleanup statements
- Rows in `storage.buckets` and other configuration tables
- `cron.schedule` and `cron.unschedule`
- Column-level grants
- View ownership and grants, security-invoker views, and materialized views
- Schema privileges, comments, partitions, domains, and publication membership
- Some policy alterations and grants derived from default privileges
- Supabase Auth, Storage, and Realtime service configuration

Function bodies may contain DML; those bodies remain part of the declarative function definition. The rule above applies to DML executed by the migration itself.

Keep local service settings in the versioned `supabase/config.toml`, not in database migrations.

For a DML-only or cron-only change, create a migration with `supabase migration new <name>`. If a cleanup function is added, declare the function in its owning schema file, generate and review its DDL migration, then add the cron registration to that migration manually.

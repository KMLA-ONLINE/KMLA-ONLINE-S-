# 전역 검색 (사람 · 그룹) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the decorative search box in the desktop header with a working search over people (approved profiles) and groups by name, plus a mobile full-screen search entry point, following the design in [docs/superpowers/specs/2026-08-29-global-search-design.md](../specs/2026-08-29-global-search-design.md).

**Architecture:** One new Postgres RPC (`search_directory`) backed by a generated `search_name` column + trigram index on `profiles` (mirroring the existing `groups.search_name` pattern), wrapped by a new `app/features/search/` feature. Desktop gets an anchored dropdown mounted in `AppHeader` (local component state, no URL). Mobile gets a full-screen `Dialog` mirroring the existing `GroupPostSearchDialog`/`useGroupPostSearch` pattern (URL-driven `?search=1` state for correct back-button behavior), triggered from the home route's existing mobile search icon. Recent clicks are cached in `localStorage` as `{kind, id, name, avatarPath}` — never a resolved signed URL — and re-resolved through the existing `createProfileMediaUrls`/`createGroupMediaUrls` helpers on every render.

**Tech Stack:** React Router 8 (SPA), Supabase (Postgres RPC + RLS), TanStack Query (not used for the dropdown/dialog fetch — plain async, mirroring `GroupPostSearchDialog`), Vitest + Testing Library, pgTAP.

---

## Before you start

Run `npm run db:start` if the local Supabase stack isn't already running (`npm run db:status` to check).

## Task 1: `profiles.search_name` column and trigram index

**Files:**

- Modify: `supabase/schemas/11-identity.sql:151` (add generated column to the `profiles` table)
- Modify: `supabase/schemas/11-identity.sql:690` (add index near the existing `profiles_pub_id_case_insensitive_key` index)

- [ ] **Step 1: Add the generated column**

In `supabase/schemas/11-identity.sql`, the `profiles` table definition starts at line 147. Insert a new line directly after `"name" "text" NOT NULL,` (line 151):

```sql
    "search_name" "text" GENERATED ALWAYS AS ("lower"("regexp_replace"("btrim"("name"), '[[:space:]]+'::"text", ''::"text", 'g'::"text"))) STORED,
```

This is byte-for-byte the same expression `groups.search_name` already uses (`supabase/schemas/21-groups.sql:1358`), so the two columns normalize names identically.

- [ ] **Step 2: Add the trigram index**

Directly after the existing index at line 690 (`CREATE UNIQUE INDEX "profiles_pub_id_case_insensitive_key" ...`), insert:

```sql

CREATE INDEX "profiles_search_name_trgm_idx" ON "public"."profiles" USING "gin" ("search_name" "extensions"."gin_trgm_ops") WHERE (("status" = 'accepted'::"public"."profile_status") AND ("deleted_at" IS NULL));
```

This mirrors `groups_search_name_trgm_idx` (`supabase/schemas/21-groups.sql:1427`) — a partial index scoped to exactly the rows `search_directory` will query.

- [ ] **Step 3: Confirm the file still parses as valid SQL**

Run: `npx supabase db lint --local --schema public --level warning --fail-on error`

This won't catch everything (the function from Task 2 doesn't exist yet), but it validates the table/index syntax in isolation. Expected: no new errors referencing `profiles.search_name` or `profiles_search_name_trgm_idx`. (If it fails only because of things unrelated to this change, note them and continue — Task 3's full reset is the real check.)

## Task 2: `search_directory` RPC

**Files:**

- Create: `supabase/schemas/53-search.sql`

- [ ] **Step 1: Write the function**

```sql
CREATE OR REPLACE FUNCTION "public"."search_directory"("p_query" "text" DEFAULT ''::"text") RETURNS TABLE("result_kind" "text", "result_id" "text", "result_name" "text", "avatar_path" "text", "sort_rank" smallint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller_profile public.profiles;
  normalized_query text := lower(
    regexp_replace(btrim(coalesce(p_query, '')), '[[:space:]]+', '', 'g')
  );
begin
  select profile.*
  into caller_profile
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'accepted'
    and profile.deleted_at is null;

  if caller_profile.id is null then
    raise exception 'search requires an accepted profile' using errcode = '42501';
  end if;

  if char_length(normalized_query) < 2 then
    return;
  end if;

  return query
  (
    select
      'profile'::text,
      person.pub_id,
      person.name,
      person.avatar_path,
      case
        when person.search_name = normalized_query then 0
        when person.search_name like normalized_query || '%' then 1
        else 2
      end::smallint
    from public.profiles as person
    where person.status = 'accepted'
      and person.deleted_at is null
      and person.search_name like '%' || normalized_query || '%'
    order by 5, person.name
    limit 5
  )
  union all
  (
    select
      'group'::text,
      group_record.slug,
      group_record.name,
      group_record.icon_path,
      case
        when group_record.search_name = normalized_query then 0
        when group_record.search_name like normalized_query || '%' then 1
        else 2
      end::smallint
    from public.groups as group_record
    where group_record.deleted_at is null
      and caller_profile.type <> 'teacher'
      and (group_record.kind = 'official' or group_record.join_policy <> 'invite_only')
      and group_record.search_name like '%' || normalized_query || '%'
    order by 5, group_record.name
    limit 5
  );
end;
$$;

ALTER FUNCTION "public"."search_directory"("p_query" "text") OWNER TO "postgres";
```

Notes for whoever reviews this migration later (per `AGENTS.md`'s "every generated migration is untrusted" rule):

- Teachers get people results but never group results — they can't discover groups at all (`functional-spec/accounts.md` §2.1, and `discover_groups` enforces the same restriction by raising `42501` outright; here we just return an empty group branch instead of erroring, since the caller may still want people results).
- Invite-only unofficial groups are excluded so their existence isn't leaked to non-members, matching `discover_groups`'s filter (`supabase/schemas/21-groups.sql:754-755`).
- The two `union all` branches are independently `order by ... limit 5`'d _before_ the union. The client buckets rows by `result_kind` and preserves array order (Task 5), so it never depends on how Postgres interleaves the two branches in the combined result set — only the order _within_ each branch matters, and that's fixed by each branch's own `ORDER BY`.
- `caller_profile.id is null` covers unauthenticated _and_ not-yet-accepted callers in one check, same idiom as `discover_groups`.

- [ ] **Step 2: Grant execute to `authenticated` only**

Append to the same file:

```sql

REVOKE ALL ON FUNCTION "public"."search_directory"("p_query" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_directory"("p_query" "text") TO "authenticated";
```

This matches `discover_groups`'s grant block (`supabase/schemas/21-groups.sql:1555-1556`).

## Task 3: Generate, review, and apply the migration

**Files:**

- Create: `supabase/migrations/<timestamp>_add_search_directory.sql` (generated, not hand-written)

- [ ] **Step 1: Generate the migration draft**

Run: `npm run db:diff -- add_search_directory`

Expected: a new file appears under `supabase/migrations/` containing the `profiles.search_name` column, the two new indexes/function from Tasks 1–2, plus the `discover_groups`-style grant/revoke statements.

- [ ] **Step 2: Read the generated file in full**

Per `supabase/README.md`'s mandatory checklist: confirm it contains _only_ the additive changes from Tasks 1–2 (no unrelated `DROP`/`ALTER` statements the diff tool may have picked up from an unrelated uncommitted schema edit). Confirm the function body matches Task 2 exactly (diff tools sometimes reformat whitespace only — that's fine; a changed `WHERE` clause is not).

- [ ] **Step 3: Reset the local database**

Run: `npm run db:reset`

Expected: all migrations (including the new one) and `supabase/seed.sql` replay cleanly, exit code 0.

- [ ] **Step 4: Regenerate TypeScript types**

Run: `npm run db:types`

Expected: `app/shared/supabase/database.types.ts` now has a `search_directory` entry under `Database["public"]["Functions"]` with `Args: { p_query?: string }` and the five-column `Returns` shape from Task 2.

- [ ] **Step 5: Commit**

```bash
git add supabase/schemas/11-identity.sql supabase/schemas/53-search.sql supabase/migrations app/shared/supabase/database.types.ts
git commit -m "$(cat <<'EOF'
feat(search): add search_directory RPC and profiles.search_name index

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 4: pgTAP tests for `search_directory`

**Files:**

- Create: `supabase/tests/search_directory.test.sql`

- [ ] **Step 1: Write the test file**

Seed fixtures already available from `supabase/seed.sql`: `kim-admin` (accepted, name likely doesn't match our search terms), `hanbyeol-25`, `saebyeok-24`, `pureum-23` (accepted students), `jung-teacher` (accepted teacher, `auth_user_id = '10000000-0000-0000-0000-000000000099'`), and the student behind `auth_user_id = '10000000-0000-0000-0000-000000000001'`.

```sql
begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

-- A distinctively-named profile so name matching is unambiguous.
insert into public.profiles (auth_user_id, pub_id, name, type, status, cohort, gender, academic_track)
values (
  '10000000-0000-0000-0000-000000000097',
  'sd-person',
  '검색대상인물',
  'student',
  'accepted',
  30,
  'male',
  'domestic'
);

insert into public.groups (
  slug, slug_is_custom, kind, name, join_policy, identity_policy, posting_policy, created_by
)
values
  (
    'sd-open-group', true, 'unofficial', '검색대상그룹', 'open', 'identified', 'members',
    (select id from public.profiles where pub_id = 'kim-admin')
  ),
  (
    'sd-invite-group', true, 'unofficial', '검색대상초대전용', 'invite_only', 'identified', 'members',
    (select id from public.profiles where pub_id = 'kim-admin')
  );

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select is(
  (select count(*) from public.search_directory(p_query => '검')),
  0::bigint,
  'a one-character query returns nothing'
);

select is(
  (
    select result_name from public.search_directory(p_query => '검색대상인물')
    where result_kind = 'profile'
  ),
  '검색대상인물',
  'an accepted profile matches by name'
);

select is(
  (
    select array_agg(result_id order by result_name)
    from public.search_directory(p_query => '검색대상')
    where result_kind = 'group'
  ),
  array['sd-open-group'],
  'invite-only unofficial groups are excluded from group results'
);

select is(
  (select count(*) from public.search_directory(p_query => '검색대상') where result_kind = 'profile'),
  1::bigint,
  'people and group matches for the same prefix do not leak into each other''s bucket'
);

-- Switch to the teacher fixture.
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000099',
  true
);

select is(
  (select count(*) from public.search_directory(p_query => '검색대상') where result_kind = 'group'),
  0::bigint,
  'teachers never receive group results'
);

select is(
  (select count(*) from public.search_directory(p_query => '검색대상인물') where result_kind = 'profile'),
  1::bigint,
  'teachers still receive people results'
);

select throws_ok(
  $$select * from public.search_directory(p_query => '검색') from (select set_config('request.jwt.claim.sub', '', true)) as _reset$$,
  '42501',
  null,
  'an unauthenticated caller is rejected'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it**

Run: `npm run test:db -- supabase/tests/search_directory.test.sql`

Expected: `1..7`, all `ok`, exit code 0. If the `throws_ok` line fails because of how the inline `set_config` subquery interacts with the surrounding statement, replace it with a two-statement version (`select set_config('request.jwt.claim.sub', '', true); select throws_ok(...)`) — the point being asserted is that a caller with no matching accepted profile gets `42501`, not the exact SQL shape.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/search_directory.test.sql
git commit -m "$(cat <<'EOF'
test(search): add pgTAP coverage for search_directory

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 5: Data layer — types, cache keys, `searchDirectory` query

**Files:**

- Create: `app/features/search/model/types.ts`
- Create: `app/features/search/data/cache.ts`
- Create: `app/features/search/data/queries.ts`
- Test: `test/features/search/data/queries.test.ts`

- [ ] **Step 1: Write the types**

```ts
// app/features/search/model/types.ts
import type { Database } from "~/shared/supabase/database.types";

export type SearchDirectoryRow =
  Database["public"]["Functions"]["search_directory"]["Returns"][number];

export interface DirectoryPersonResult {
  kind: "profile";
  id: string; // pub_id
  name: string;
  avatarPath: string | null;
  avatarUrl: string | null;
}

export interface DirectoryGroupResult {
  kind: "group";
  id: string; // slug
  name: string;
  avatarPath: string | null; // group icon_path, resolved the same way as a profile avatar
  avatarUrl: string | null;
}

export type DirectoryResult = DirectoryPersonResult | DirectoryGroupResult;

export interface DirectorySearchResult {
  people: DirectoryPersonResult[];
  groups: DirectoryGroupResult[];
}
```

- [ ] **Step 2: Write the cache keys**

```ts
// app/features/search/data/cache.ts
export const searchKeys = {
  all: ["search"] as const,
  directory: (query: string) =>
    [...searchKeys.all, "directory", query] as const,
};
```

- [ ] **Step 3: Write the failing test for `searchDirectory`**

```ts
// test/features/search/data/queries.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: vi.fn(),
}));
vi.mock("~/features/profiles/data/media", () => ({
  createProfileMediaUrls: vi.fn(),
}));
vi.mock("~/features/groups/data/files", () => ({
  createGroupMediaUrls: vi.fn(),
}));

import { getSupabase } from "~/shared/supabase/client";
import { createProfileMediaUrls } from "~/features/profiles/data/media";
import { createGroupMediaUrls } from "~/features/groups/data/files";
import { searchDirectory } from "~/features/search/data/queries";

describe("searchDirectory", () => {
  beforeEach(() => {
    vi.mocked(createProfileMediaUrls).mockResolvedValue(new Map());
    vi.mocked(createGroupMediaUrls).mockResolvedValue(new Map());
  });

  it("buckets rows by kind and resolves avatars from the matching bucket", async () => {
    vi.mocked(getSupabase).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            result_kind: "profile",
            result_id: "person-1",
            result_name: "김민준",
            avatar_path: "avatar/path-1",
            sort_rank: 0,
          },
          {
            result_kind: "group",
            result_id: "group-1",
            result_name: "화학 스터디",
            avatar_path: "icon/path-1",
            sort_rank: 1,
          },
        ],
        error: null,
      }),
    } as never);
    vi.mocked(createProfileMediaUrls).mockResolvedValue(
      new Map([["avatar/path-1", "https://signed/avatar-1"]]),
    );
    vi.mocked(createGroupMediaUrls).mockResolvedValue(
      new Map([["icon/path-1", "https://signed/icon-1"]]),
    );

    const result = await searchDirectory("김민");

    expect(result.people).toEqual([
      {
        kind: "profile",
        id: "person-1",
        name: "김민준",
        avatarPath: "avatar/path-1",
        avatarUrl: "https://signed/avatar-1",
      },
    ]);
    expect(result.groups).toEqual([
      {
        kind: "group",
        id: "group-1",
        name: "화학 스터디",
        avatarPath: "icon/path-1",
        avatarUrl: "https://signed/icon-1",
      },
    ]);
    expect(createProfileMediaUrls).toHaveBeenCalledWith(["avatar/path-1"]);
    expect(createGroupMediaUrls).toHaveBeenCalledWith(["icon/path-1"]);
  });

  it("throws on an RPC error", async () => {
    vi.mocked(getSupabase).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: new Error("boom") }),
    } as never);

    await expect(searchDirectory("김민")).rejects.toThrow("boom");
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npx vitest run test/features/search/data/queries.test.ts`

Expected: FAIL — `Cannot find module '~/features/search/data/queries'`.

- [ ] **Step 5: Implement `searchDirectory`**

```ts
// app/features/search/data/queries.ts
import { createGroupMediaUrls } from "~/features/groups/data/files";
import { createProfileMediaUrls } from "~/features/profiles/data/media";
import type {
  DirectoryGroupResult,
  DirectoryPersonResult,
  DirectorySearchResult,
  SearchDirectoryRow,
} from "~/features/search/model/types";
import { getSupabase } from "~/shared/supabase/client";

export async function searchDirectory(
  query: string,
): Promise<DirectorySearchResult> {
  const { data, error } = await getSupabase().rpc("search_directory", {
    p_query: query,
  });
  if (error) throw error;

  const rows = (data ?? []) as SearchDirectoryRow[];
  const peopleRows = rows.filter((row) => row.result_kind === "profile");
  const groupRows = rows.filter((row) => row.result_kind === "group");

  const [avatarUrls, iconUrls] = await Promise.all([
    createProfileMediaUrls(peopleRows.map((row) => row.avatar_path)),
    createGroupMediaUrls(groupRows.map((row) => row.avatar_path)),
  ]);

  const people: DirectoryPersonResult[] = peopleRows.map((row) => ({
    kind: "profile",
    id: row.result_id,
    name: row.result_name,
    avatarPath: row.avatar_path,
    avatarUrl: row.avatar_path
      ? (avatarUrls.get(row.avatar_path) ?? null)
      : null,
  }));

  const groups: DirectoryGroupResult[] = groupRows.map((row) => ({
    kind: "group",
    id: row.result_id,
    name: row.result_name,
    avatarPath: row.avatar_path,
    avatarUrl: row.avatar_path ? (iconUrls.get(row.avatar_path) ?? null) : null,
  }));

  return { people, groups };
}
```

- [ ] **Step 6: Run the test again**

Run: `npx vitest run test/features/search/data/queries.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 7: Commit**

```bash
git add app/features/search/model/types.ts app/features/search/data/cache.ts app/features/search/data/queries.ts test/features/search/data/queries.test.ts
git commit -m "$(cat <<'EOF'
feat(search): add searchDirectory query with avatar resolution

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 6: `hasMinimumSearchLength`

**Files:**

- Create: `app/features/search/model/format.ts`
- Test: `test/features/search/model/format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/features/search/model/format.test.ts
import { describe, expect, it } from "vitest";

import { hasMinimumSearchLength } from "~/features/search/model/format";

describe("hasMinimumSearchLength", () => {
  it("rejects fewer than two characters after trimming", () => {
    expect(hasMinimumSearchLength("")).toBe(false);
    expect(hasMinimumSearchLength(" 김 ")).toBe(false);
  });

  it("accepts two or more characters", () => {
    expect(hasMinimumSearchLength("김민")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/features/search/model/format.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

```ts
// app/features/search/model/format.ts
export function normalizeSearchInput(value: string): string {
  return value.normalize("NFC").trim();
}

export function hasMinimumSearchLength(value: string): boolean {
  return Array.from(normalizeSearchInput(value)).length >= 2;
}
```

Same shape as `normalizeAdminSearch` (`app/features/admin/model/types.ts:16-19`) and `hasMinimumGroupSearchLength` (`app/features/groups/model/format.ts:58-60`), except the threshold is 2 per the design doc.

- [ ] **Step 4: Run it again**

Run: `npx vitest run test/features/search/model/format.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add app/features/search/model/format.ts test/features/search/model/format.test.ts
git commit -m "$(cat <<'EOF'
feat(search): add hasMinimumSearchLength

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 7: Recent search entries (localStorage)

**Files:**

- Create: `app/features/search/model/recent-searches.ts`
- Test: `test/features/search/model/recent-searches.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/features/search/model/recent-searches.test.ts
import { beforeEach, describe, expect, it } from "vitest";

import {
  addRecentSearchEntry,
  readRecentSearchEntries,
  RECENT_SEARCH_STORAGE_KEY,
} from "~/features/search/model/recent-searches";

describe("recent search entries", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stores the newest entry first", () => {
    addRecentSearchEntry({
      kind: "profile",
      id: "person-1",
      name: "김민준",
      avatarPath: null,
    });
    addRecentSearchEntry({
      kind: "group",
      id: "group-1",
      name: "화학 스터디",
      avatarPath: "icon/1",
    });

    const entries = readRecentSearchEntries();
    expect(entries.map((entry) => entry.id)).toEqual(["group-1", "person-1"]);
  });

  it("moves a re-clicked entry to the front instead of duplicating it", () => {
    addRecentSearchEntry({
      kind: "profile",
      id: "person-1",
      name: "김민준",
      avatarPath: null,
    });
    addRecentSearchEntry({
      kind: "group",
      id: "group-1",
      name: "화학 스터디",
      avatarPath: null,
    });
    addRecentSearchEntry({
      kind: "profile",
      id: "person-1",
      name: "김민준",
      avatarPath: null,
    });

    const entries = readRecentSearchEntries();
    expect(entries.map((entry) => entry.id)).toEqual(["person-1", "group-1"]);
  });

  it("caps the list at 10 entries", () => {
    for (let index = 0; index < 12; index += 1) {
      addRecentSearchEntry({
        kind: "profile",
        id: `person-${index}`,
        name: `사람${index}`,
        avatarPath: null,
      });
    }

    expect(readRecentSearchEntries()).toHaveLength(10);
  });

  it("falls back to an empty list when storage is corrupted", () => {
    window.localStorage.setItem(RECENT_SEARCH_STORAGE_KEY, "not json");
    expect(readRecentSearchEntries()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/features/search/model/recent-searches.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

```ts
// app/features/search/model/recent-searches.ts
export const RECENT_SEARCH_STORAGE_KEY = "kmla-online:search-recent:v1";

const MAX_RECENT = 10;

/** 검색 결과 행과 같은 모양. `avatarPath`는 signed URL이 아니라 원본 Storage path다 —
 * DATA_CACHE_POLICY.md에 따라 signed URL은 localStorage에 두지 않고, 보여줄 때마다
 * `createProfileMediaUrls`/`createGroupMediaUrls`로 새로 구한다. */
export interface RecentSearchEntry {
  kind: "profile" | "group";
  id: string;
  name: string;
  avatarPath: string | null;
}

export function readRecentSearchEntries(): RecentSearchEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCH_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentSearchEntry);
  } catch {
    return [];
  }
}

export function addRecentSearchEntry(entry: RecentSearchEntry): void {
  if (typeof window === "undefined") return;
  const current = readRecentSearchEntries();
  const deduped = current.filter(
    (existing) => !(existing.kind === entry.kind && existing.id === entry.id),
  );
  const next = [entry, ...deduped].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(
      RECENT_SEARCH_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // 용량 초과. 다음 클릭에서 다시 시도한다.
  }
}

function isRecentSearchEntry(value: unknown): value is RecentSearchEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.kind === "profile" || candidate.kind === "group") &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    (candidate.avatarPath === null || typeof candidate.avatarPath === "string")
  );
}
```

- [ ] **Step 4: Run it again**

Run: `npx vitest run test/features/search/model/recent-searches.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/features/search/model/recent-searches.ts test/features/search/model/recent-searches.test.ts
git commit -m "$(cat <<'EOF'
feat(search): add localStorage recent-search entries

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 8: Resolving recent-entry avatars

**Files:**

- Modify: `app/features/search/data/queries.ts`
- Test: `test/features/search/data/queries.test.ts`

- [ ] **Step 1: Add a failing test for the resolver**

Append to `test/features/search/data/queries.test.ts` (same file, same mocks already set up at the top):

```ts
import { resolveRecentSearchEntryUrls } from "~/features/search/data/queries";

describe("resolveRecentSearchEntryUrls", () => {
  beforeEach(() => {
    vi.mocked(createProfileMediaUrls).mockResolvedValue(new Map());
    vi.mocked(createGroupMediaUrls).mockResolvedValue(new Map());
  });

  it("resolves each entry through the bucket matching its kind", async () => {
    vi.mocked(createProfileMediaUrls).mockResolvedValue(
      new Map([["avatar/1", "https://signed/avatar-1"]]),
    );
    vi.mocked(createGroupMediaUrls).mockResolvedValue(
      new Map([["icon/1", "https://signed/icon-1"]]),
    );

    const urls = await resolveRecentSearchEntryUrls([
      { kind: "profile", id: "p1", name: "김민준", avatarPath: "avatar/1" },
      { kind: "group", id: "g1", name: "화학 스터디", avatarPath: "icon/1" },
      { kind: "profile", id: "p2", name: "이서연", avatarPath: null },
    ]);

    expect(urls.get("profile:avatar/1")).toBe("https://signed/avatar-1");
    expect(urls.get("group:icon/1")).toBe("https://signed/icon-1");
    expect(createProfileMediaUrls).toHaveBeenCalledWith(["avatar/1"]);
    expect(createGroupMediaUrls).toHaveBeenCalledWith(["icon/1"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/features/search/data/queries.test.ts`

Expected: FAIL — `resolveRecentSearchEntryUrls` is not exported.

- [ ] **Step 3: Implement it**

Add to `app/features/search/data/queries.ts` (below `searchDirectory`):

```ts
import type { RecentSearchEntry } from "~/features/search/model/recent-searches";

export async function resolveRecentSearchEntryUrls(
  entries: RecentSearchEntry[],
): Promise<Map<string, string>> {
  const profilePaths = entries
    .filter((entry) => entry.kind === "profile")
    .map((entry) => entry.avatarPath);
  const groupPaths = entries
    .filter((entry) => entry.kind === "group")
    .map((entry) => entry.avatarPath);

  const [profileUrls, groupUrls] = await Promise.all([
    createProfileMediaUrls(profilePaths),
    createGroupMediaUrls(groupPaths),
  ]);

  const combined = new Map<string, string>();
  for (const [path, url] of profileUrls) combined.set(`profile:${path}`, url);
  for (const [path, url] of groupUrls) combined.set(`group:${path}`, url);
  return combined;
}
```

Add the `RecentSearchEntry` import to the top of the file alongside the existing imports.

- [ ] **Step 4: Run the test again**

Run: `npx vitest run test/features/search/data/queries.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add app/features/search/data/queries.ts test/features/search/data/queries.test.ts
git commit -m "$(cat <<'EOF'
feat(search): resolve recent-entry avatars per bucket kind

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 9: `useRecentSearchEntries` hook

**Files:**

- Create: `app/features/search/hooks/use-recent-search-entries.ts`
- Test: `test/features/search/hooks/use-recent-search-entries.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// test/features/search/hooks/use-recent-search-entries.test.tsx
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/search/data/queries", () => ({
  resolveRecentSearchEntryUrls: vi.fn(),
}));

import { addRecentSearchEntry } from "~/features/search/model/recent-searches";
import { resolveRecentSearchEntryUrls } from "~/features/search/data/queries";
import { useRecentSearchEntries } from "~/features/search/hooks/use-recent-search-entries";

describe("useRecentSearchEntries", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(resolveRecentSearchEntryUrls).mockResolvedValue(new Map());
  });

  it("does nothing while inactive", () => {
    addRecentSearchEntry({
      kind: "profile",
      id: "p1",
      name: "김민준",
      avatarPath: null,
    });

    const { result } = renderHook(() => useRecentSearchEntries(false));
    expect(result.current).toEqual([]);
    expect(resolveRecentSearchEntryUrls).not.toHaveBeenCalled();
  });

  it("reads storage and attaches resolved avatar URLs once active", async () => {
    addRecentSearchEntry({
      kind: "profile",
      id: "p1",
      name: "김민준",
      avatarPath: "avatar/1",
    });
    vi.mocked(resolveRecentSearchEntryUrls).mockResolvedValue(
      new Map([["profile:avatar/1", "https://signed/1"]]),
    );

    const { result } = renderHook(() => useRecentSearchEntries(true));

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]).toEqual({
      kind: "profile",
      id: "p1",
      name: "김민준",
      avatarPath: "avatar/1",
      avatarUrl: "https://signed/1",
    });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/features/search/hooks/use-recent-search-entries.test.tsx`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

```ts
// app/features/search/hooks/use-recent-search-entries.ts
import { useEffect, useState } from "react";

import { resolveRecentSearchEntryUrls } from "~/features/search/data/queries";
import {
  readRecentSearchEntries,
  type RecentSearchEntry,
} from "~/features/search/model/recent-searches";

export interface ResolvedRecentSearchEntry extends RecentSearchEntry {
  avatarUrl: string | null;
}

/** `active`가 켜지는 순간(패널이 열리는 순간)에만 한 번 읽고 해석한다 — 검색창이 닫혀
 * 있는 동안 매 렌더마다 localStorage를 다시 읽을 이유가 없다. */
export function useRecentSearchEntries(
  active: boolean,
): ResolvedRecentSearchEntry[] {
  const [entries, setEntries] = useState<ResolvedRecentSearchEntry[]>([]);

  useEffect(() => {
    if (!active) return;

    let current = true;
    const raw = readRecentSearchEntries();
    void resolveRecentSearchEntryUrls(raw).then((urls) => {
      if (!current) return;
      setEntries(
        raw.map((entry) => ({
          ...entry,
          avatarUrl: entry.avatarPath
            ? (urls.get(`${entry.kind}:${entry.avatarPath}`) ?? null)
            : null,
        })),
      );
    });

    return () => {
      current = false;
    };
  }, [active]);

  return entries;
}
```

- [ ] **Step 4: Run the test again**

Run: `npx vitest run test/features/search/hooks/use-recent-search-entries.test.tsx`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add app/features/search/hooks/use-recent-search-entries.ts test/features/search/hooks/use-recent-search-entries.test.tsx
git commit -m "$(cat <<'EOF'
feat(search): add useRecentSearchEntries hook

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 10: Shared results panel

**Files:**

- Create: `app/features/search/components/directory-search-panel.tsx`
- Test: `test/features/search/components/directory-search-panel.test.tsx`

This is the body both the desktop dropdown (Task 11) and the mobile dialog (Task 12) render — recent entries when the query is empty, otherwise loading/error/empty/results for the submitted query. It owns "record to recent, then let the `Link` navigate" for every row.

- [ ] **Step 1: Write the failing test**

```tsx
// test/features/search/components/directory-search-panel.test.tsx
import { describe, expect, it, vi } from "vitest";

vi.mock("~/features/search/hooks/use-recent-search-entries", () => ({
  useRecentSearchEntries: vi.fn(),
}));
vi.mock("~/features/search/model/recent-searches", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/features/search/model/recent-searches")
    >();
  return { ...actual, addRecentSearchEntry: vi.fn() };
});

import { DirectorySearchPanel } from "~/features/search/components/directory-search-panel";
import { addRecentSearchEntry } from "~/features/search/model/recent-searches";
import { useRecentSearchEntries } from "~/features/search/hooks/use-recent-search-entries";
import { renderRoute, screen } from "../../../router";

describe("DirectorySearchPanel", () => {
  it("shows recent entries when the query is empty", () => {
    vi.mocked(useRecentSearchEntries).mockReturnValue([
      {
        kind: "profile",
        id: "p1",
        name: "김민준",
        avatarPath: null,
        avatarUrl: null,
      },
    ]);

    renderRoute(() => (
      <DirectorySearchPanel
        query=""
        loading={false}
        result={null}
        error={null}
        onNavigate={() => {}}
      />
    ));

    expect(screen.getByText("최근 항목")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /김민준/ })).toHaveAttribute(
      "href",
      "/profile/p1",
    );
  });

  it("shows a spinner while loading", () => {
    vi.mocked(useRecentSearchEntries).mockReturnValue([]);
    renderRoute(() => (
      <DirectorySearchPanel
        query="김민"
        loading
        result={null}
        error={null}
        onNavigate={() => {}}
      />
    ));

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", () => {
    vi.mocked(useRecentSearchEntries).mockReturnValue([]);
    renderRoute(() => (
      <DirectorySearchPanel
        query="없음"
        loading={false}
        result={{ people: [], groups: [] }}
        error={null}
        onNavigate={() => {}}
      />
    ));

    expect(screen.getByText(/없음.*결과가 없습니다/)).toBeInTheDocument();
  });

  it("renders people and groups, records a recent entry, and calls onNavigate on click", async () => {
    vi.mocked(useRecentSearchEntries).mockReturnValue([]);
    const onNavigate = vi.fn();
    const { user } = renderRoute(() => (
      <DirectorySearchPanel
        query="김민"
        loading={false}
        result={{
          people: [
            {
              kind: "profile",
              id: "p1",
              name: "김민준",
              avatarPath: null,
              avatarUrl: null,
            },
          ],
          groups: [
            {
              kind: "group",
              id: "g1",
              name: "김민 스터디",
              avatarPath: null,
              avatarUrl: null,
            },
          ],
        }}
        error={null}
        onNavigate={onNavigate}
      />
    ));

    expect(screen.getByRole("link", { name: /김민준/ })).toHaveAttribute(
      "href",
      "/profile/p1",
    );
    const groupLink = screen.getByRole("link", { name: /김민 스터디/ });
    expect(groupLink).toHaveAttribute("href", "/groups/g1");

    await user.click(groupLink);
    expect(addRecentSearchEntry).toHaveBeenCalledWith({
      kind: "group",
      id: "g1",
      name: "김민 스터디",
      avatarPath: null,
    });
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("shows an error message", () => {
    vi.mocked(useRecentSearchEntries).mockReturnValue([]);
    renderRoute(() => (
      <DirectorySearchPanel
        query="김민"
        loading={false}
        result={null}
        error="검색 결과를 불러오지 못했습니다."
        onNavigate={() => {}}
      />
    ));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "검색 결과를 불러오지 못했습니다.",
    );
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/features/search/components/directory-search-panel.test.tsx`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

```tsx
// app/features/search/components/directory-search-panel.tsx
import { Link } from "react-router";

import { GroupAvatar } from "~/features/groups/components/group-avatar";
import { addRecentSearchEntry } from "~/features/search/model/recent-searches";
import { useRecentSearchEntries } from "~/features/search/hooks/use-recent-search-entries";
import type {
  DirectoryResult,
  DirectorySearchResult,
} from "~/features/search/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Spinner } from "~/shared/ui/spinner";

export function DirectorySearchPanel({
  query,
  loading,
  result,
  error,
  onNavigate,
}: {
  query: string;
  loading: boolean;
  result: DirectorySearchResult | null;
  error: string | null;
  onNavigate: () => void;
}) {
  const recentActive = query === "";
  const recentEntries = useRecentSearchEntries(recentActive);

  function selectResult(item: DirectoryResult) {
    addRecentSearchEntry({
      kind: item.kind,
      id: item.id,
      name: item.name,
      avatarPath: item.avatarPath,
    });
    onNavigate();
  }

  if (recentActive) {
    if (recentEntries.length === 0) {
      return (
        <p className="p-6 text-center text-sm text-muted-foreground">
          사람이나 그룹 이름으로 검색해 보세요.
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-1 p-2">
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
          최근 항목
        </p>
        {recentEntries.map((entry) => (
          <Link
            key={`${entry.kind}:${entry.id}`}
            to={
              entry.kind === "profile"
                ? `/profile/${entry.id}`
                : `/groups/${entry.id}`
            }
            onClick={() => onNavigate()}
            className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"
          >
            {entry.kind === "profile" ? (
              <UserAvatar src={entry.avatarUrl} name={entry.name} size="sm" />
            ) : (
              <GroupAvatar
                name={entry.name}
                iconPath={entry.avatarUrl}
                className="size-6"
              />
            )}
            <span className="truncate text-sm">{entry.name}</span>
          </Link>
        ))}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center p-6">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="p-6 text-center text-sm text-destructive">
        {error}
      </p>
    );
  }

  if (!result) return null;

  if (result.people.length === 0 && result.groups.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        &ldquo;{query}&rdquo;에 대한 검색 결과가 없습니다.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-2">
      {result.people.length > 0 ? (
        <section className="flex flex-col gap-1">
          <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
            사람
          </p>
          {result.people.map((person) => (
            <Link
              key={person.id}
              to={`/profile/${person.id}`}
              onClick={() => selectResult(person)}
              className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"
            >
              <UserAvatar src={person.avatarUrl} name={person.name} size="sm" />
              <span className="truncate text-sm">{person.name}</span>
            </Link>
          ))}
        </section>
      ) : null}
      {result.groups.length > 0 ? (
        <section className="flex flex-col gap-1">
          <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
            그룹
          </p>
          {result.groups.map((group) => (
            <Link
              key={group.id}
              to={`/groups/${group.id}`}
              onClick={() => selectResult(group)}
              className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"
            >
              <GroupAvatar
                name={group.name}
                iconPath={group.avatarUrl}
                className="size-6"
              />
              <span className="truncate text-sm">{group.name}</span>
            </Link>
          ))}
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test again**

Run: `npx vitest run test/features/search/components/directory-search-panel.test.tsx`

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add app/features/search/components/directory-search-panel.tsx test/features/search/components/directory-search-panel.test.tsx
git commit -m "$(cat <<'EOF'
feat(search): add shared directory search results panel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 11: Desktop dropdown (`GlobalSearchDropdown`)

**Files:**

- Create: `app/features/search/components/global-search-dropdown.tsx`
- Test: `test/features/search/components/global-search-dropdown.test.tsx`

Local component state only (no URL) — it's an anchored dropdown, not a full-screen takeover, so there's no back-button concern to solve. Opens on focus, closes on outside click / Escape / a result click.

- [ ] **Step 1: Write the failing test**

```tsx
// test/features/search/components/global-search-dropdown.test.tsx
import { describe, expect, it, vi } from "vitest";

vi.mock("~/features/search/data/queries", () => ({
  searchDirectory: vi.fn(),
}));
vi.mock("~/features/search/hooks/use-recent-search-entries", () => ({
  useRecentSearchEntries: vi.fn().mockReturnValue([]),
}));

import { searchDirectory } from "~/features/search/data/queries";
import { GlobalSearchDropdown } from "~/features/search/components/global-search-dropdown";
import { renderRoute, screen, waitFor } from "../../../router";

describe("GlobalSearchDropdown", () => {
  it("stays closed until the input is focused", () => {
    renderRoute(() => <GlobalSearchDropdown />);
    expect(screen.queryByText("최근 항목")).not.toBeInTheDocument();
  });

  it("does not search until Enter, and rejects fewer than two characters", async () => {
    const { user } = renderRoute(() => <GlobalSearchDropdown />);
    const input = screen.getByRole("searchbox", { name: "사람 · 그룹 검색" });

    await user.click(input);
    await user.type(input, "김");
    expect(searchDirectory).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(searchDirectory).not.toHaveBeenCalled();

    await user.type(input, "민");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(searchDirectory).toHaveBeenCalledWith("김민"));
  });

  it("closes on outside click", async () => {
    vi.mocked(searchDirectory).mockResolvedValue({ people: [], groups: [] });
    const { user } = renderRoute(() => (
      <div>
        <GlobalSearchDropdown />
        <button type="button">밖</button>
      </div>
    ));

    await user.click(
      screen.getByRole("searchbox", { name: "사람 · 그룹 검색" }),
    );
    expect(screen.getByText(/찾아보세요/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "밖" }));
    expect(screen.queryByText(/찾아보세요/)).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const { user } = renderRoute(() => <GlobalSearchDropdown />);
    const input = screen.getByRole("searchbox", { name: "사람 · 그룹 검색" });
    await user.click(input);
    expect(screen.getByText(/찾아보세요/)).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByText(/찾아보세요/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/features/search/components/global-search-dropdown.test.tsx`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

```tsx
// app/features/search/components/global-search-dropdown.tsx
import { SearchIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { DirectorySearchPanel } from "~/features/search/components/directory-search-panel";
import { searchDirectory } from "~/features/search/data/queries";
import {
  hasMinimumSearchLength,
  normalizeSearchInput,
} from "~/features/search/model/format";
import type { DirectorySearchResult } from "~/features/search/model/types";
import { Input } from "~/shared/ui/input";

interface SettledSearch {
  query: string;
  result: DirectorySearchResult;
  error: string | null;
}

export function GlobalSearchDropdown() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [composing, setComposing] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [settled, setSettled] = useState<SettledSearch | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!submittedQuery) return;

    let current = true;
    void (async () => {
      try {
        const result = await searchDirectory(submittedQuery);
        if (current) setSettled({ query: submittedQuery, result, error: null });
      } catch {
        if (current)
          setSettled({
            query: submittedQuery,
            result: { people: [], groups: [] },
            error: "검색 결과를 불러오지 못했습니다.",
          });
      }
    })();

    return () => {
      current = false;
    };
  }, [submittedQuery]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    setInput("");
    setSubmittedQuery("");
    setSettled(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (composing) return;
    const normalized = normalizeSearchInput(input);
    if (!hasMinimumSearchLength(normalized)) return;
    setSubmittedQuery(normalized);
  }

  const current = settled?.query === submittedQuery ? settled : null;
  const loading = submittedQuery !== "" && current === null;

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <form onSubmit={submit}>
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(event) => {
            setInput(event.currentTarget.value);
            setComposing(false);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
          className="h-9 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
          placeholder="사람 · 그룹 검색"
          aria-label="사람 · 그룹 검색"
          autoComplete="off"
          type="search"
        />
      </form>

      {open ? (
        <div className="absolute top-full left-0 z-30 mt-1 max-h-96 w-full overflow-y-auto rounded-lg border bg-popover shadow-lg">
          <DirectorySearchPanel
            query={current?.query ?? (loading ? submittedQuery : "")}
            loading={loading}
            result={current?.result ?? null}
            error={current?.error ?? null}
            onNavigate={close}
          />
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test again**

Run: `npx vitest run test/features/search/components/global-search-dropdown.test.tsx`

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/features/search/components/global-search-dropdown.tsx test/features/search/components/global-search-dropdown.test.tsx
git commit -m "$(cat <<'EOF'
feat(search): add desktop GlobalSearchDropdown

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 12: Mobile full-screen dialog

**Files:**

- Create: `app/features/search/hooks/use-directory-search-dialog.ts`
- Create: `app/features/search/components/global-search-dialog.tsx`
- Test: `test/features/search/components/global-search-dialog.test.tsx`

Mirrors `useGroupPostSearch` (`app/features/posts/hooks/use-group-post-search.ts`) and `GroupPostSearchDialog` (`app/features/posts/components/group-post-search-dialog.tsx`) almost exactly, minus the `groupId` scoping — the URL-driven `?search=1` state is what makes the hardware/browser back button close the overlay instead of leaving the page. It is **not** generalized out of the posts feature: the two hooks are ~30 lines each and touching the already-tested `useGroupPostSearch` isn't warranted just to save one duplicate hook.

- [ ] **Step 1: Write the hook**

```ts
// app/features/search/hooks/use-directory-search-dialog.ts
import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

const OPEN_PARAM = "search";
const QUERY_PARAM = "q";

interface DirectorySearchLocationState {
  directorySearchPushed?: boolean;
}

export interface DirectorySearchDialogState {
  open: boolean;
  submittedQuery: string;
  openSearch: () => void;
  closeSearch: () => void;
  submitQuery: (query: string) => void;
}

/** `useGroupPostSearch`(app/features/posts/hooks/use-group-post-search.ts)와 같은 이유로
 * 열림 상태를 URL에 둔다: 모바일 전체화면에서 뒤로가기는 이 오버레이만 닫아야지 홈을
 * 떠나면 안 된다. */
export function useDirectorySearchDialog(): DirectorySearchDialogState {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state as DirectorySearchLocationState | null;
  const open = searchParams.get(OPEN_PARAM) === "1";
  const submittedQuery = open
    ? (searchParams.get(QUERY_PARAM)?.normalize("NFC").trim() ?? "")
    : "";

  const openSearch = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.set(OPEN_PARAM, "1");
    next.delete(QUERY_PARAM);
    void setSearchParams(next, {
      preventScrollReset: true,
      state: {
        directorySearchPushed: true,
      } satisfies DirectorySearchLocationState,
    });
  }, [searchParams, setSearchParams]);

  const closeSearch = useCallback(() => {
    if (locationState?.directorySearchPushed) {
      void navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete(OPEN_PARAM);
    next.delete(QUERY_PARAM);
    void setSearchParams(next, { replace: true, preventScrollReset: true });
  }, [locationState, navigate, searchParams, setSearchParams]);

  const submitQuery = useCallback(
    (query: string) => {
      const next = new URLSearchParams(searchParams);
      next.set(OPEN_PARAM, "1");
      if (query) next.set(QUERY_PARAM, query);
      else next.delete(QUERY_PARAM);
      void setSearchParams(next, {
        replace: true,
        preventScrollReset: true,
        state: locationState,
      });
    },
    [locationState, searchParams, setSearchParams],
  );

  return { open, submittedQuery, openSearch, closeSearch, submitQuery };
}
```

- [ ] **Step 2: Write the failing test for the dialog**

```tsx
// test/features/search/components/global-search-dialog.test.tsx
import { act } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { useNavigate, useSearchParams } from "react-router";

vi.mock("~/features/search/data/queries", () => ({
  searchDirectory: vi.fn().mockResolvedValue({ people: [], groups: [] }),
}));
vi.mock("~/features/search/hooks/use-recent-search-entries", () => ({
  useRecentSearchEntries: vi.fn().mockReturnValue([]),
}));

import { searchDirectory } from "~/features/search/data/queries";
import { GlobalSearchDialog } from "~/features/search/components/global-search-dialog";
import { useDirectorySearchDialog } from "~/features/search/hooks/use-directory-search-dialog";
import { renderRoute, screen, waitFor } from "../../../router";

let goBack: () => void = () => {
  throw new Error("HomeRoute가 아직 mount되지 않았다.");
};

function HomeRoute() {
  const [searchParams] = useSearchParams();
  const { openSearch } = useDirectorySearchDialog();
  const navigate = useNavigate();

  useEffect(() => {
    goBack = () => void navigate(-1);
  }, [navigate]);

  return (
    <>
      <output data-testid="search-open">
        {searchParams.get("search") ?? ""}
      </output>
      <button type="button" onClick={openSearch}>
        검색 열기
      </button>
      <GlobalSearchDialog />
    </>
  );
}

function renderHome(entry = "/") {
  return renderRoute(HomeRoute, { path: "/", initialEntries: [entry] });
}

describe("GlobalSearchDialog", () => {
  it("opens full screen and searches only after Enter", async () => {
    const { user } = renderHome();
    await user.click(screen.getByRole("button", { name: "검색 열기" }));

    const input = await screen.findByRole("searchbox", {
      name: "사람 · 그룹 검색어",
    });
    await user.type(input, "김민");
    expect(searchDirectory).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(searchDirectory).toHaveBeenCalledWith("김민"));
  });

  it("closes on the back button instead of leaving home", async () => {
    const { user } = renderHome();
    await user.click(screen.getByRole("button", { name: "검색 열기" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    act(() => {
      goBack();
    });

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("search-open")).toBeEmptyDOMElement();
  });

  it("closes with the X button", async () => {
    const { user } = renderHome();
    await user.click(screen.getByRole("button", { name: "검색 열기" }));
    await user.click(await screen.findByRole("button", { name: "검색 닫기" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run test/features/search/components/global-search-dialog.test.tsx`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the dialog**

```tsx
// app/features/search/components/global-search-dialog.tsx
import { SearchIcon, XIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

import { DirectorySearchPanel } from "~/features/search/components/directory-search-panel";
import { searchDirectory } from "~/features/search/data/queries";
import { useDirectorySearchDialog } from "~/features/search/hooks/use-directory-search-dialog";
import {
  hasMinimumSearchLength,
  normalizeSearchInput,
} from "~/features/search/model/format";
import type { DirectorySearchResult } from "~/features/search/model/types";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";

const DIALOG_CLASS =
  "flex h-svh w-full max-w-full flex-col gap-0 overflow-hidden rounded-none bg-background p-0 ring-0 top-0 left-0 translate-x-0 translate-y-0";

interface SettledSearch {
  query: string;
  result: DirectorySearchResult;
  error: string | null;
}

/** 모바일 전용 진입점(홈 헤더의 검색 아이콘)에서만 연다. 데스크톱은
 * `GlobalSearchDropdown`을 쓰므로 이 dialog는 데스크톱에서 열리지 않는다. */
export function GlobalSearchDialog() {
  const { open, submittedQuery, closeSearch, submitQuery } =
    useDirectorySearchDialog();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeSearch()}>
      <DialogContent
        showCloseButton={false}
        className={DIALOG_CLASS}
        {...(submittedQuery ? {} : { initialFocus: inputRef })}
      >
        <SearchPanel
          submittedQuery={submittedQuery}
          inputRef={inputRef}
          onSubmitQuery={submitQuery}
          onClose={closeSearch}
        />
      </DialogContent>
    </Dialog>
  );
}

function SearchPanel({
  submittedQuery,
  inputRef,
  onSubmitQuery,
  onClose,
}: {
  submittedQuery: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onSubmitQuery: (query: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(submittedQuery);
  const [composing, setComposing] = useState(false);
  const [settled, setSettled] = useState<SettledSearch | null>(null);

  useEffect(() => {
    if (!submittedQuery) return;

    let current = true;
    void (async () => {
      try {
        const result = await searchDirectory(submittedQuery);
        if (current) setSettled({ query: submittedQuery, result, error: null });
      } catch {
        if (current)
          setSettled({
            query: submittedQuery,
            result: { people: [], groups: [] },
            error: "검색 결과를 불러오지 못했습니다.",
          });
      }
    })();

    return () => {
      current = false;
    };
  }, [submittedQuery]);

  const current = settled?.query === submittedQuery ? settled : null;
  const loading = submittedQuery !== "" && current === null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (composing) return;
    const normalized = normalizeSearchInput(query);
    if (!hasMinimumSearchLength(normalized)) return;
    onSubmitQuery(normalized);
  };

  return (
    <>
      <DialogHeader className="flex-row items-center gap-2 border-b p-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="검색 닫기"
          onClick={onClose}
        >
          <XIcon />
        </Button>
        <form onSubmit={submit} className="flex-1">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={(event) => {
                setQuery(event.currentTarget.value);
                setComposing(false);
              }}
              autoComplete="off"
              placeholder="사람 · 그룹 검색"
              aria-label="사람 · 그룹 검색어"
              className="h-9 rounded-full border-0 bg-muted pl-9 shadow-none [&::-webkit-search-cancel-button]:appearance-none"
              type="search"
            />
          </div>
        </form>
        <DialogTitle className="sr-only">전역 검색</DialogTitle>
        <DialogDescription className="sr-only">
          사람과 그룹을 이름으로 검색합니다.
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DirectorySearchPanel
          query={submittedQuery}
          loading={loading}
          result={current?.result ?? null}
          error={current?.error ?? null}
          onNavigate={() => {}}
        />
      </div>
    </>
  );
}
```

`onNavigate` is a no-op here: clicking a result `Link` navigates to a different route entirely, which unmounts the home route (and this dialog with it) — there's no dropdown-style local `open` state to reset like there is in Task 11.

- [ ] **Step 5: Run the test again**

Run: `npx vitest run test/features/search/components/global-search-dialog.test.tsx`

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add app/features/search/hooks/use-directory-search-dialog.ts app/features/search/components/global-search-dialog.tsx test/features/search/components/global-search-dialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(search): add mobile full-screen GlobalSearchDialog

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 13: Barrel export

**Files:**

- Create: `app/features/search/index.ts`

- [ ] **Step 1: Write it**

```ts
// app/features/search/index.ts
export { DirectorySearchPanel } from "~/features/search/components/directory-search-panel";
export { GlobalSearchDialog } from "~/features/search/components/global-search-dialog";
export { GlobalSearchDropdown } from "~/features/search/components/global-search-dropdown";
export { searchKeys } from "~/features/search/data/cache";
export {
  resolveRecentSearchEntryUrls,
  searchDirectory,
} from "~/features/search/data/queries";
export { useDirectorySearchDialog } from "~/features/search/hooks/use-directory-search-dialog";
export { useRecentSearchEntries } from "~/features/search/hooks/use-recent-search-entries";
export {
  hasMinimumSearchLength,
  normalizeSearchInput,
} from "~/features/search/model/format";
export {
  addRecentSearchEntry,
  readRecentSearchEntries,
  RECENT_SEARCH_STORAGE_KEY,
  type RecentSearchEntry,
} from "~/features/search/model/recent-searches";
export type {
  DirectoryGroupResult,
  DirectoryPersonResult,
  DirectoryResult,
  DirectorySearchResult,
} from "~/features/search/model/types";
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .` (or `npm run check:fast`, which includes it)

Expected: no new errors from `app/features/search/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/features/search/index.ts
git commit -m "$(cat <<'EOF'
feat(search): add app/features/search public barrel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 14: Wire the desktop header

**Files:**

- Modify: `app/features/app-shell/components/app-header.tsx:1-45`

- [ ] **Step 1: Replace the placeholder input**

Replace lines 1-9 (imports) with:

```tsx
import { MessagesSquareIcon } from "lucide-react";
import { Link } from "react-router";

import { useAppShell } from "~/features/app-shell/context/app-shell-context";
import { GlobalSearchDropdown } from "~/features/search";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Button } from "~/shared/ui/button";
import { cn } from "~/shared/lib/utils";
```

(`SearchIcon` and `Input` are no longer used directly here — they now live inside `GlobalSearchDropdown`.)

Replace lines 38-45 (the placeholder `<div>`) with:

```tsx
<GlobalSearchDropdown />
```

- [ ] **Step 2: Run the existing app-shell tests**

Run: `npx vitest run test/features/app-shell`

Expected: PASS. (If no test file currently covers `AppHeader` directly, this just confirms nothing else broke — that's fine, Task 11's dropdown tests already cover the new behavior.)

- [ ] **Step 3: Commit**

```bash
git add app/features/app-shell/components/app-header.tsx
git commit -m "$(cat <<'EOF'
feat(search): wire GlobalSearchDropdown into the desktop header

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 15: Wire the mobile entry point

**Files:**

- Modify: `app/routes/app/home.tsx:1-30` (imports), `:196-204` (search button)

- [ ] **Step 1: Swap the search button's destination**

The mobile `PageHeader` already has a search icon (`app/routes/app/home.tsx:196-204`) that currently links to `/groups/discover` — that was a stand-in. Replace it with the real search trigger.

`SearchIcon`'s existing import line doesn't change (it's still used, just on a `<button>` instead of inside a `<Link>`). Add one new import line alongside the other `~/features/*` imports near the top of `app/routes/app/home.tsx`:

```tsx
import {
  GlobalSearchDialog,
  useDirectorySearchDialog,
} from "~/features/search";
```

- [ ] **Step 2: Replace the search action button**

Replace the search `<Button>` block (`app/routes/app/home.tsx:196-204`):

```tsx
<Button
  variant="ghost"
  size="icon"
  nativeButton={false}
  aria-label="검색"
  render={<Link to="/groups/discover" />}
>
  <SearchIcon />
</Button>
```

with:

```tsx
<Button
  variant="ghost"
  size="icon"
  aria-label="검색"
  onClick={openDirectorySearch}
>
  <SearchIcon />
</Button>
```

- [ ] **Step 3: Wire the hook and mount the dialog**

Inside `FeedPage` (`app/routes/app/home.tsx:175-176`), add the hook call:

```tsx
export default function FeedPage({ loaderData }: Route.ComponentProps) {
  const { page, error, mealDay, birthdays, absences } = loaderData;
  const { profile } = useAppShell();
  const { openSearch: openDirectorySearch } = useDirectorySearchDialog();
```

And mount `<GlobalSearchDialog />` once, alongside the existing top-level JSX (right after the closing `</PageHeader>` `/>`, before the `<div className="grid ...">`):

```tsx
<GlobalSearchDialog />
```

- [ ] **Step 4: Run the home route's existing tests**

Run: `npx vitest run test/routes/app/home.test.ts`

Expected: PASS — this file doesn't currently assert anything about the search button, so no existing assertion needs updating.

- [ ] **Step 5: Commit**

```bash
git add app/routes/app/home.tsx
git commit -m "$(cat <<'EOF'
feat(search): open GlobalSearchDialog from the home search icon

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 16: Documentation updates

**Files:**

- Modify: `docs/functional-spec/accounts.md:100-105` (§3.3)
- Modify: `docs/DATA_CACHE_POLICY.md` (§2, §3)

- [ ] **Step 1: Update the spec**

In `docs/functional-spec/accounts.md`, §3.3 currently ends with:

```
- 사람·그룹·게시물을 한 번에 찾는 전역 검색은 아직 제공하지 않는다. 데스크톱 헤더의 검색창은 자리만 잡아 둔 상태다.
```

Delete that line (people/group search is no longer unimplemented — post search still is, so keep that half true in the new section instead). Then, after §3.5 (`### 3.5 입력 자동 완성`, ending at line 118), append a new subsection:

```markdown
### 3.6 전역 검색

- 데스크톱 헤더와 모바일 홈 화면 헤더의 검색 아이콘에서 연다.
- 사람(승인된 사용자)과 그룹을 이름으로 찾는다. 게시물 검색은 아직 제공하지 않는다.
- 검색어를 2자 이상 입력하고 `Enter`를 눌러야 조회한다. 입력 중에는 매 글자마다 서버에 묻지 않는다.
- 데스크톱은 검색창 아래 패널에 결과를 표시한다. 모바일은 검색창을 누르면 전체 화면으로 전환된다.
- 그룹 결과에는 공식 그룹과, 초대 전용이 아닌 비공식 그룹만 포함한다. 교사에게는 그룹 결과를 제공하지 않는다(§7.4의 그룹 찾기 제한과 동일).
- 결과를 누르면 해당 프로필 또는 그룹으로 이동하고, 그 항목을 최근 항목에 남긴다.
- 검색창을 누르면(입력 전) 최근에 눌러서 들어간 사람·그룹 항목을 보여준다. 이 기록은 현재 기기에만 저장하며 계정별로 나뉘지 않는다.
```

- [ ] **Step 2: Update the cache policy doc**

In `docs/DATA_CACHE_POLICY.md`, add a row to the key-structure code block (§2):

```
["search", "directory", query]
```

And a row to the staleTime table (§3):

| 데이터         | staleTime | 이유                                                             |
| -------------- | --------- | ---------------------------------------------------------------- |
| 전역 검색 결과 | 0초       | 매 검색이 사용자의 명시적 제출이라 재사용보다 최신성이 우선한다. |

(`app/features/search/data/queries.ts`'s `searchDirectory` is called directly, not through `QueryClient` — this row documents the _policy_ for consistency with the rest of the file even though there's no TanStack Query cache entry to configure; if a later change moves it onto `QueryClient`, this is the value to use.)

- [ ] **Step 3: Commit**

```bash
git add docs/functional-spec/accounts.md docs/DATA_CACHE_POLICY.md
git commit -m "$(cat <<'EOF'
docs(search): document §3.6 전역 검색 and its cache policy

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

## Task 17: Full verification

- [ ] **Step 1: Full check**

Run: `npm run check`

Expected: lint, format, typecheck, and the full Vitest suite all pass.

- [ ] **Step 2: pgTAP**

Run: `npm run test:db`

Expected: all suites pass, including `search_directory.test.sql` from Task 4.

- [ ] **Step 3: Build**

Run: `npm run build`

Expected: exits 0 (proves the service worker still generates against real output, per `AGENTS.md`).

- [ ] **Step 4: Manual browser check**

Start the dev server (`npm run dev` or the existing `dev` preview config) and, logged in as an accepted user:

- Desktop: click the header search box, type a known profile/group name (2+ chars), press Enter, confirm the dropdown shows matching people/groups, click one, confirm navigation and that it now appears under "최근 항목" next time you focus the box.
- Mobile viewport: tap the home search icon, confirm it opens full screen, confirm the browser/hardware back button closes it back to home (not further back), confirm the X button also closes it.
- Log in as the teacher fixture (or any teacher account) and confirm group results are absent from both surfaces while people results still work.

Report what you saw — this step has no automated pass/fail, so don't claim it's done without actually opening the browser and checking each bullet.

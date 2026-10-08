import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 열려 있는 옛 앱을 깨는 마이그레이션이 최소 클라이언트 버전을 올리지 않고 나가지 못하게 한다.
 *
 * 배포는 DB를 먼저 올리고, 사용자의 앱은 그 뒤에야 새 빌드로 바뀐다. 그 사이 옛 앱이 부르는
 * `public`의 함수·테이블·컬럼이 사라지면 조용히 실패하므로, 그런 문장이 있는 마이그레이션은
 * 같은 파일에서 `public.min_client_version()`도 다시 정의해야 한다(`npm run db:diff`가
 * 스키마의 값 변경을 같은 초안에 넣는다). 앱의 `CLIENT_COMPAT_VERSION`이 같은 값인지는
 * `client-version.test.ts`가 본다.
 *
 * 권한 회수(`revoke`)는 보지 않는다. 새 객체마다 기본 권한을 걷어 내는 관용구라 거의 모든
 * 마이그레이션에 있고, 그것까지 잡으면 표시를 습관처럼 달게 된다.
 *
 * 옛 앱이 쓰지 않는 것을 지우는 경우처럼 실제로는 안전하면 그 마이그레이션에
 * `-- client-compat: safe <이유>`를 적는다. 이유 없는 표시는 받지 않는다.
 */

/** 이 검사가 생기기 전 마이그레이션은 이미 배포됐으므로 보지 않는다. */
const BASELINE = "20261008032614";

const PUBLIC = String.raw`"?public"?\.`;
const BREAKING_PATTERNS = [
  new RegExp(
    String.raw`\bdrop\s+(function|table|view|materialized\s+view|type)\s+(if\s+exists\s+)?${PUBLIC}`,
    "i",
  ),
  new RegExp(
    String.raw`\balter\s+(table|function|view|type)\s+(if\s+exists\s+)?(only\s+)?${PUBLIC}[\s\S]*\b(drop\s+(column\b|(?!constraint|default|not\s+null)\w)|rename\b|(set\s+data\s+)?type\s|set\s+not\s+null\b)`,
    "i",
  ),
];
const BUMP = new RegExp(
  String.raw`\bcreate\s+or\s+replace\s+function\s+${PUBLIC}"?min_client_version"?\s*\(`,
  "i",
);
const SAFE = /--[ \t]*client-compat:[ \t]*safe[ \t]+\S/i;

/**
 * 실제로 실행되는 DDL만 남긴다. 함수 본문(달러 인용)과 주석은 지우고 문자열은 비운다.
 * 한 번에 왼쪽부터 훑어야 문자열 안의 `--`나 `;`, 주석 안의 `'`에 속지 않는다.
 */
function executableSql(sql: string): string {
  return sql.replace(
    /\$(\w*)\$[\s\S]*?\$\1\$|'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g,
    (token) => (token.startsWith("'") ? "''" : ""),
  );
}

/** 옛 앱을 깰 수 있는 문장들. */
export function findBreakingStatements(sql: string): string[] {
  return executableSql(sql)
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter((statement) =>
      BREAKING_PATTERNS.some((pattern) => pattern.test(statement)),
    );
}

export function needsClientCompatBump(sql: string): string[] {
  if (BUMP.test(executableSql(sql)) || SAFE.test(sql)) return [];
  return findBreakingStatements(sql);
}

describe("findBreakingStatements", () => {
  it.each([
    'DROP FUNCTION IF EXISTS "public"."list_posts"("p_limit" integer);',
    'alter table "public"."posts" drop column "legacy_title";',
    'ALTER TABLE ONLY "public"."posts"\n  RENAME COLUMN "body" TO "content";',
    "drop table public.old_things;",
    'ALTER TABLE "public"."posts" ALTER COLUMN "author_id" TYPE uuid USING author_id::uuid;',
    "alter table public.posts alter column title set not null;",
    "comment on column public.t.c is 'old -- legacy'; drop table public.old;",
  ])("옛 앱을 깨는 문장을 잡는다: %s", (sql) => {
    expect(findBreakingStatements(sql)).toHaveLength(1);
  });

  it.each([
    'REVOKE ALL ON FUNCTION "public"."f"() FROM "anon", "authenticated";',
    'alter table "public"."posts" add column "x" text;',
    'alter table "public"."posts" drop constraint "posts_x_check";',
    'alter table "public"."posts" alter column "x" drop default;',
    'drop function if exists "private"."helper"();',
    "create function public.f() returns void language plpgsql as $$ begin drop table public.t; end $$;",
    "-- drop table public.t;\nselect 1;",
    "comment on table public.t is 'drop table public.t; rename';",
    "-- don't\nalter table public.t add column x text;",
  ])("깨지 않는 문장은 넘긴다: %s", (sql) => {
    expect(findBreakingStatements(sql)).toEqual([]);
  });

  it("같은 마이그레이션에서 최소 버전을 올리거나 이유를 적으면 통과한다", () => {
    const drop = 'drop function "public"."f"();';

    expect(needsClientCompatBump(drop)).toHaveLength(1);
    expect(
      needsClientCompatBump(
        `${drop}\nCREATE OR REPLACE FUNCTION public.min_client_version()\n RETURNS integer AS $function$ select 2; $function$;`,
      ),
    ).toEqual([]);
    expect(
      needsClientCompatBump(
        `-- client-compat: safe 앱이 부른 적 없는 함수\n${drop}`,
      ),
    ).toEqual([]);
    expect(
      needsClientCompatBump(`-- client-compat: safe\n${drop}`),
    ).toHaveLength(1);
    expect(
      needsClientCompatBump(
        `${drop}\n-- create or replace function public.min_client_version(`,
      ),
    ).toHaveLength(1);
  });
});

const DEFINED_VERSION = new RegExp(
  String.raw`\bcreate\s+or\s+replace\s+function\s+${PUBLIC}"?min_client_version"?\s*\(\s*\)[\s\S]*?\$(\w*)\$\s*select\s+(\d+)\s*;?\s*\$\1\$`,
  "i",
);

describe("supabase/migrations", () => {
  const dir = resolve(process.cwd(), "supabase/migrations");
  const allFiles = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const files = allFiles.filter((name) => name.slice(0, 14) > BASELINE);

  it("최소 클라이언트 버전은 다시 정의될 때마다 올라간다", () => {
    let previous = 0;
    for (const name of allFiles) {
      const sql = readFileSync(resolve(dir, name), "utf8");
      if (!BUMP.test(executableSql(sql))) continue;

      const version = Number(DEFINED_VERSION.exec(sql)?.[2]);
      expect(
        version,
        `${name}: min_client_version()은 이전 값(${previous})보다 커야 합니다.`,
      ).toBeGreaterThan(previous);
      previous = version;
    }
    expect(
      previous,
      "min_client_version()을 정의한 마이그레이션이 없습니다.",
    ).toBeGreaterThan(0);
  });

  it.each(files.length > 0 ? files : ["(없음)"])(
    "%s는 옛 앱을 깨면 최소 클라이언트 버전을 올린다",
    (name) => {
      if (name === "(없음)") return;
      const breaking = needsClientCompatBump(
        readFileSync(resolve(dir, name), "utf8"),
      );

      expect(
        breaking,
        "옛 앱이 쓰는 public 객체를 지우거나 바꿉니다. supabase/README.md의 " +
          '"Changes that break open clients"대로 min_client_version()과 ' +
          "CLIENT_COMPAT_VERSION을 함께 올리거나, 안전하면 " +
          "`-- client-compat: safe <이유>`를 적으세요.",
      ).toEqual([]);
    },
  );
});

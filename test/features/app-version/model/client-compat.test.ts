import { describe, expect, it } from "vitest";

// @ts-expect-error The check is an untyped MJS module run by Node.
import * as clientCompat from "../../../../scripts/client-compat.mjs";

const { findBreakingChanges, readSchemaVersion } = clientCompat as {
  findBreakingChanges: (before: string, after: string) => string[];
  readSchemaVersion: (sql: string) => number | null;
};

/** `database.types.ts`와 같은 모양으로 public 스키마만 채운다. */
function types({
  tables = "",
  functions = "",
  enums = "",
}: {
  tables?: string;
  functions?: string;
  enums?: string;
}) {
  return `export type Database = {
  public: {
    Tables: {${tables}}
    Views: {}
    Functions: {${functions}}
    Enums: {${enums}}
    CompositeTypes: {}
  }
}`;
}

function postsTable(row: string, insert: string, update: string) {
  return `
  posts: {
    Row: {${row}}
    Insert: {${insert}}
    Update: {${update}}
    Relationships: []
  }`;
}

describe("findBreakingChanges", () => {
  it("함수 삭제와 새 필수 인자를 잡는다", () => {
    const before = types({
      functions: `
        list_posts: { Args: { p_limit: number }; Returns: string }
        old_rpc: { Args: never; Returns: undefined }`,
    });
    const after = types({
      functions: `
        list_posts: { Args: { p_limit: number; p_group: string }; Returns: string }`,
    });

    expect(findBreakingChanges(before, after)).toEqual([
      "함수 list_posts 인자.p_group 필수 항목 추가",
      "함수 old_rpc 삭제",
    ]);
  });

  it("기본값 있는 인자와 반환 컬럼 추가는 깨지지 않는다", () => {
    const before = types({
      functions: `
        list_posts: {
          Args: { p_limit: number }
          Returns: { id: string; title: string }[]
        }`,
    });
    const after = types({
      functions: `
        list_posts: {
          Args: { p_limit: number; p_before?: string }
          Returns: { id: string; title: string; created_at: string }[]
        }`,
    });

    expect(findBreakingChanges(before, after)).toEqual([]);
  });

  it("반환 컬럼 삭제와 인자 타입 변경을 잡는다", () => {
    const before = types({
      functions: `
        list_posts: {
          Args: { p_limit: number }
          Returns: { id: string; title: string }[]
        }`,
    });
    const after = types({
      functions: `
        list_posts: {
          Args: { p_limit: string }
          Returns: { id: string }[]
        }`,
    });

    expect(findBreakingChanges(before, after)).toEqual([
      "함수 list_posts 인자.p_limit 타입 변경",
      "함수 list_posts 반환.title 삭제",
    ]);
  });

  it("테이블 컬럼 삭제·필수 컬럼 추가·enum 값 삭제를 잡고, 선택 컬럼 추가는 넘긴다", () => {
    const before = types({
      tables: postsTable(
        "id: string; legacy: string",
        "id?: string; legacy?: string",
        "id?: string; legacy?: string",
      ),
      enums: `status: "active" | "blocked"`,
    });
    const after = types({
      tables: postsTable(
        "id: string; author: string; note: string | null",
        "id?: string; author: string; note?: string | null",
        "id?: string; author?: string; note?: string | null",
      ),
      enums: `status: "active"`,
    });

    expect(findBreakingChanges(before, after)).toEqual([
      "테이블 posts.legacy 삭제",
      "테이블 posts Insert.legacy 삭제",
      "테이블 posts Insert.author 필수 항목 추가",
      "테이블 posts Update.legacy 삭제",
      'enum status 값 "blocked" 삭제',
    ]);
  });

  it("같으면 아무것도 없다", () => {
    const same = types({
      tables: postsTable("id: string", "id?: string", "id?: string"),
      functions: `f: { Args: never; Returns: number }`,
    });

    expect(findBreakingChanges(same, same)).toEqual([]);
  });
});

describe("readSchemaVersion", () => {
  it("min_client_version() 본문의 숫자를 읽는다", () => {
    expect(
      readSchemaVersion(
        'CREATE OR REPLACE FUNCTION "public"."min_client_version"() RETURNS integer\n    AS $$\n  select 3;\n$$;',
      ),
    ).toBe(3);
  });
});

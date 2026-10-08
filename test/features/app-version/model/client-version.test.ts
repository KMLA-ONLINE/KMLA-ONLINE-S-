import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CLIENT_COMPAT_VERSION } from "~/features/app-version/model/client-version";

describe("CLIENT_COMPAT_VERSION", () => {
  it("DB의 min_client_version()과 같은 값이다", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/schemas/01-foundation.sql"),
      "utf8",
    );
    const match =
      /FUNCTION "public"\."min_client_version"\(\)[\s\S]*?\$\$\s*select\s+(\d+)\s*;\s*\$\$/.exec(
        sql,
      );

    expect(match, "min_client_version() body not found").not.toBeNull();
    expect(Number(match?.[1])).toBe(CLIENT_COMPAT_VERSION);
  });
});

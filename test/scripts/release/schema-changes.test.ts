import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/release/schema-changes.mjs");
const fixtures: string[] = [];

function detect(paths: string[]) {
  const root = mkdtempSync(join(tmpdir(), "kmla-schema-changes-"));
  fixtures.push(root);
  const output = join(root, "output");
  const result = spawnSync(process.execPath, [script], {
    input: paths.join("\n") + "\n",
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: output },
  });
  return { ...result, output: readFileSync(output, "utf8") };
}

/** `key<<DELIMITER` 형식까지 읽는 GITHUB_OUTPUT 파서. */
function outputs(text: string) {
  const values: Record<string, string> = {};
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const heredoc = /^([^=<]+)<<(.+)$/.exec(line);
    if (heredoc) {
      const [, key, delimiter] = heredoc;
      const body: string[] = [];
      while (lines[++index] !== delimiter) body.push(lines[index]);
      values[key] = body.join("\n");
    } else if (line.includes("=")) {
      const [key, ...value] = line.split("=");
      values[key] = value.join("=");
    }
  }
  return values;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true });
});

describe("remote schema change detection", () => {
  it("passes an app-only change", () => {
    const result = detect([
      "app/features/feed/ui/feed.tsx",
      "supabase/seed.sql",
      "supabase/tests/feed.test.sql",
      "supabase/README.md",
    ]);

    expect(result.status).toBe(0);
    expect(outputs(result.output)).toEqual({ changed: "false", paths: "" });
  });

  it("lists migrations, schemas, Edge Functions, and config once each", () => {
    const result = detect([
      "app/routes/home.tsx",
      "supabase/migrations/20261103000000_third.sql",
      "supabase/schemas/31-posts.sql",
      "supabase/functions/dispatch-notifications/index.ts",
      "supabase/config.toml",
      "supabase/schemas/31-posts.sql",
    ]);

    expect(result.status).toBe(0);
    expect(outputs(result.output)).toEqual({
      changed: "true",
      paths: [
        "supabase/migrations/20261103000000_third.sql",
        "supabase/schemas/31-posts.sql",
        "supabase/functions/dispatch-notifications/index.ts",
        "supabase/config.toml",
      ].join("\n"),
    });
  });
});

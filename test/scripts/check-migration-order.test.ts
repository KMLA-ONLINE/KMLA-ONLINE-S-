import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/check-migration-order.mjs");
const fixtures: string[] = [];

function git(root: string, ...args: string[]) {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: root, stdio: "ignore" },
  );
}

function write(root: string, files: Record<string, string | null>) {
  for (const [name, source] of Object.entries(files)) {
    const file = join(root, "supabase/migrations", name);
    if (source === null) rmSync(file);
    else writeFileSync(file, source);
  }
}

/** `base` 태그에 base 파일을, HEAD에 그 위의 변경(null은 삭제)을 커밋한 저장소. */
function repository(
  base: Record<string, string>,
  head: Record<string, string | null>,
) {
  const root = mkdtempSync(join(tmpdir(), "kmla-migration-order-"));
  fixtures.push(root);
  mkdirSync(join(root, "supabase/migrations"), { recursive: true });
  git(root, "init", "-q", "-b", "main");
  write(root, base);
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", "base");
  git(root, "tag", "base");
  write(root, head);
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", "head");
  return root;
}

function check(root: string) {
  return spawnSync(process.execPath, [script, "base", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "" },
  });
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true });
});

const base = {
  "20261101000000_first.sql": "select 1;",
  "20261102000000_second.sql": "select 2;",
};

describe("migration order check", () => {
  it("accepts migrations newer than the base branch's latest", () => {
    const root = repository(base, {
      "20261103000000_third.sql": "select 3;",
      "20261104000000_fourth.sql": "select 4;",
    });

    const result = check(root);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("accepts a change without migrations", () => {
    const result = check(repository(base, {}));

    expect(result.status).toBe(0);
  });

  it("rejects a new migration that sorts before the base branch's latest", () => {
    const root = repository(base, {
      "20261101120000_late_arrival.sql": "select 3;",
    });

    const result = check(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("20261101120000_late_arrival.sql");
    expect(result.stderr).toContain("20261102000000");
  });

  it("rejects editing a migration that the base branch already has", () => {
    const root = repository(base, {
      "20261101000000_first.sql": "select 10;",
    });

    const result = check(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("20261101000000_first.sql");
  });

  it("rejects deleting or renaming a migration that the base branch already has", () => {
    const root = repository(base, {
      "20261102000000_second.sql": null,
      "20261103000000_second.sql": "select 2;",
    });

    const result = check(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("20261102000000_second.sql");
  });

  it("rejects a new file that is not named like a migration", () => {
    const root = repository(base, {
      "20261103_third.sql": "select 3;",
    });

    const result = check(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("20261103_third.sql");
  });

  it("rejects two new migrations with the same version", () => {
    const root = repository(base, {
      "20261103000000_a.sql": "select 3;",
      "20261103000000_b.sql": "select 4;",
    });

    const result = check(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("20261103000000");
  });
});

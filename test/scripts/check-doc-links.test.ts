import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/check-doc-links.mjs");
const fixtures: string[] = [];

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "kmla-doc-links-"));
  fixtures.push(root);
  for (const [file, source] of Object.entries(files)) {
    const destination = join(root, file);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source);
  }
  return root;
}

function check(root: string) {
  return spawnSync(process.execPath, [script, root], { encoding: "utf8" });
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true });
});

describe("project documentation link check", () => {
  it("accepts Korean, formatted and duplicate heading anchors without writing files", () => {
    const source = "# 제목\n\n## `코드`와 **서식**\n\n## 제목\n\n## 제목-1\n";
    const root = fixture({
      "README.md":
        "[한글](docs/guide.md#%EC%A0%9C%EB%AA%A9)\n[서식](docs/guide.md#코드와-서식)\n[중복](docs/guide.md#제목-1)\n[충돌](docs/guide.md#제목-1-1)",
      "docs/guide.md": source,
    });
    expect(check(root).status).toBe(0);
    expect(readFileSync(join(root, "docs/guide.md"), "utf8")).toBe(source);
  });

  it("checks images, references, same-document anchors and root-relative paths", () => {
    const root = fixture({
      "docs/README.md":
        "# 안내\n[현재](#안내)\n[루트](/README.md)\n![그림][asset]\n[다음][guide]\n\n[asset]: assets/example.svg\n[guide]: guide.md?raw=1#목적",
      "README.md": "# 프로젝트",
      "docs/guide.md": "## 목적",
      "docs/assets/example.svg": "<svg />",
    });
    expect(check(root).status).toBe(0);
  });

  it("ignores code examples, external schemes, protocol-relative URLs and vendored skills", () => {
    const root = fixture({
      "README.md":
        "`[예시](missing.md)`\n\n```md\n[예시](missing.md)\n```\n\n[web](https://example.com)\n[mail](mailto:a@example.com)\n[cdn](//example.com/a)\n[멘션](m:1)",
      ".agents/skills/example/SKILL.md": "[외부 자료](missing.md)",
    });
    expect(check(root).status).toBe(0);
  });

  it("reports missing files and anchors with the referring document's line", () => {
    const root = fixture({
      "README.md":
        "# 시작\n[파일](docs/missing.md)\n[앵커](docs/guide.md#없음)",
      "docs/guide.md": "# 목적",
      "app/features/example/AGENTS.md": "[가이드](../../../missing.md)",
      "supabase/README.md": "[설정](missing.toml)",
    });
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("README.md:2: missing target");
    expect(result.stderr).toContain("README.md:3: missing heading anchor");
    expect(result.stderr).toContain("app/features/example/AGENTS.md:1");
    expect(result.stderr).toContain("supabase/README.md:1");
  });

  it("fails clearly on repository escapes and malformed percent encoding", () => {
    const root = fixture({
      "docs/README.md": "[밖](../../outside.md)\n[잘못된 주소](bad%ZZ.md)",
    });
    const result = check(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("target is outside the repository");
    expect(result.stderr).toContain("invalid URL encoding");
  });
});

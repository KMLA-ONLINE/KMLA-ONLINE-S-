import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/check.mjs");
const fixtures: string[] = [];

// 파이프 버퍼(64KiB)를 넘기는 실패 출력. 끝 표시가 살아 있어야 덤프가 끝까지 나간 것이다.
const LOUD_FAILURE = `node -e "process.stdout.write(('y'.repeat(99) + '\\n').repeat(3000)); process.stdout.write('END-OF-OUTPUT\\n'); process.exitCode = 1"`;

function fixture(scripts: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "kmla-check-"));
  fixtures.push(root);
  const passing = {
    typegen: "true",
    "lint:only": "true",
    "typecheck:only": "true",
    "format:check": "true",
    "check:map": "true",
    "check:docs": "true",
    test: "true",
  };
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ private: true, scripts: { ...passing, ...scripts } }),
  );
  return root;
}

// CI처럼 stderr가 파이프이고 읽는 쪽이 출력 속도를 따라가지 못하는 상황을 만든다.
function check(root: string) {
  return spawnSync(`"${process.execPath}" "${script}" 2>&1 | (sleep 1; cat)`, {
    cwd: root,
    encoding: "utf8",
    shell: true,
  });
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true });
});

describe("check runner", () => {
  it("writes a large test failure in full before exiting", () => {
    const { stdout } = check(fixture({ test: LOUD_FAILURE }));

    expect(stdout).toContain("END-OF-OUTPUT");
    expect(stdout).toContain("실패 1건: vitest");
  });

  it("writes a large typegen failure in full before stopping early", () => {
    const { stdout } = check(fixture({ typegen: LOUD_FAILURE }));

    expect(stdout).toContain("END-OF-OUTPUT");
    expect(stdout).toContain("typegen이 실패해 나머지는 돌리지 않았습니다.");
    expect(stdout).not.toContain("▶ eslint");
  });
});

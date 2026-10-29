import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const APP_DIR = join(import.meta.dirname, "../../../app");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/**
 * 다크 모드에서 `--primary`는 차콜 위 링크 글자로 읽히는 밝은 파랑이고, 흰 글자를 얹는 꽉 찬 파랑은
 * `--action`이다. 한 파랑으로는 두 대비를 함께 맞출 수 없다. `bg-primary text-primary-foreground`로
 * 채우면 다크 모드에서만 연한 하늘색 위 검은 글자가 되어 버튼·칩끼리 색이 갈린다. shadcn 기본값이
 * 그 조합이므로 registry에서 새 컴포넌트를 받을 때 되살아나지 않게 소스 전체를 본다. 글자 선택
 * 강조(`selection:`)와 사이드바 토큰은 다른 쌍이라 뺀다.
 */
describe("solid blue fills", () => {
  it("use the action tokens instead of primary-foreground", () => {
    const offenders = sourceFiles(APP_DIR).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          /(?<!sidebar-)text-primary-foreground/.test(
            line.replace(/selection:text-primary-foreground/g, ""),
          )
            ? [`${relative(APP_DIR, file)}:${index + 1}`]
            : [],
        ),
    );
    expect(offenders).toEqual([]);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const APP_DIR = join(import.meta.dirname, "../../../app");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/**
 * 브라우저는 `pattern` 속성을 `^(?:…)$`로 감싸 `v` 플래그로 컴파일한다. `v` 모드에서는 문자 클래스 안의
 * 범위가 아닌 `-`가 문법 오류여서(`[a-z0-9-]`) 브라우저가 콘솔 오류를 내고 패턴 검증을 통째로 건너뛴다.
 * JS 리터럴 정규식은 `v` 없이 통과하므로 같은 식을 옮겨 쓸 때 놓치기 쉽다. JSX 문자열 속성은 이스케이프를
 * 해석하지 않아 소스 텍스트가 곧 속성값이다.
 */
describe("pattern attributes", () => {
  it("compile as the browser compiles them", () => {
    const offenders = sourceFiles(APP_DIR).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/\bpattern="([^"]*)"/g)].flatMap(
        ([, pattern]) => {
          try {
            new RegExp(`^(?:${pattern})$`, "v");
            return [];
          } catch {
            return [`${relative(APP_DIR, file)}: ${pattern}`];
          }
        },
      ),
    );
    expect(offenders).toEqual([]);
  });
});

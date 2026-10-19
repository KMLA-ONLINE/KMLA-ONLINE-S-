import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const APP_DIR = join(import.meta.dirname, "../../../app");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

/**
 * `group-has-*`·`peer-has-*`·`dark:has-*`는 `:is(:where(.group):has(…) *)`, `:is(.dark *):has(…)`처럼
 * `:is()`와 `:has()`를 함께 쓰는 선택자를 만든다. Chrome은 이 꼴이 하나라도 있으면 DOM에 노드가 붙거나
 * 빠질 때마다 문서 전체 스타일을 다시 계산한다. 메시지 50개 대화방에서 키 입력(제어 textarea가 자식
 * 텍스트를 바꾼다)과 시간 툴팁 하나에 30ms씩 들었다. 같은 뜻은 `[[data-slot=field]:has(:disabled)_&]:`,
 * `[.dark_&]:has-*:`처럼 `:is()` 없는 조상 선택자로 쓴다. `shared/ui`를 registry에서 다시 받으면
 * 되살아나므로 소스 전체를 본다.
 */
describe(":has() inside :is() utilities", () => {
  it("are not used anywhere in app/", () => {
    const offenders = sourceFiles(APP_DIR).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          /\b(group|peer)-has-|\bdark:has-/.test(line)
            ? [`${relative(APP_DIR, file)}:${index + 1}`]
            : [],
        ),
    );
    expect(offenders).toEqual([]);
  });
});

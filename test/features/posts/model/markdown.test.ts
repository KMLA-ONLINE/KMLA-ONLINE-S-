import { describe, expect, it } from "vitest";

import {
  extractPostPlainText,
  fromPostEditorMarkdown,
  normalizePostMarkdownSource,
  parsePostMarkdown,
  sanitizePostMarkdown,
  toMilkdownMarkdown,
  toPostEditorMarkdown,
  toPostRenderMarkdown,
} from "~/features/posts/model/markdown";

describe("Markdown v1", () => {
  it("preserves nested allowed formatting and absolute HTTP(S) links", () => {
    const markdown =
      "## Title\n\n**bold *italic ~~strike~~*** [site](https://example.com/a)";

    expect(sanitizePostMarkdown(markdown)).toContain(
      "**bold *italic ~~strike~~***",
    );
    expect(sanitizePostMarkdown(markdown)).toContain(
      "[site](https://example.com/a)",
    );
  });

  it("flattens h1, code, images, tables, lists, and raw HTML", () => {
    const markdown = [
      "# H1",
      "",
      "`inline`",
      "",
      "```js\nalert(1)\n```",
      "",
      "![alt](https://example.com/a.png)",
      "",
      "- list",
      "",
      "| a | b |\n| - | - |\n| c | d |",
      "",
      "<script>alert(1)</script>",
    ].join("\n");
    const safe = sanitizePostMarkdown(markdown);
    const types = parsePostMarkdown(markdown).children.map((node) => node.type);

    expect(types).toEqual(types.map(() => "paragraph"));
    expect(safe).not.toMatch(/# |`|!\[|\| -|^- |<script/m);
    expect(safe).toContain("H1");
    expect(safe).toContain("inline");
    expect(safe).toContain("alt");
    expect(safe).not.toContain("<script>");
  });

  it("removes link semantics from relative and unsafe URLs", () => {
    const safe = sanitizePostMarkdown(
      "[js](javascript:alert(1)) [relative](/path) [mail](mailto:a@b.com)",
    );

    expect(safe).not.toContain("](");
    expect(safe).toContain("js");
    expect(safe).toContain("relative");
  });

  it("extracts readable plain text from the sanitized AST", () => {
    expect(
      extractPostPlainText(
        "## Heading\n\n**Hello** [world](https://example.com)",
      ),
    ).toBe("Heading\n\nHello world");
  });

  it("removes boundary newlines and preserves internal line breaks", () => {
    expect(normalizePostMarkdownSource("\r\n첫째 줄\r\n둘째 줄\r\n")).toBe(
      "첫째 줄\n둘째 줄",
    );
    expect(normalizePostMarkdownSource("\n첫째 줄\n\n둘째 줄\n")).toBe(
      "첫째 줄\n\n둘째 줄",
    );
  });

  it("round-trips one Enter as one line and two Enters as a blank line", () => {
    expect(fromPostEditorMarkdown("첫째 줄\n\n둘째 줄")).toBe(
      "첫째 줄\n둘째 줄",
    );
    expect(fromPostEditorMarkdown("첫째 줄\n\n<br />\n\n둘째 줄")).toBe(
      "첫째 줄\n\n둘째 줄",
    );
    expect(toPostEditorMarkdown("첫째 줄\n둘째 줄")).toBe("첫째 줄\n둘째 줄");
    expect(toPostEditorMarkdown("첫째 줄\n\n둘째 줄")).toBe(
      "첫째 줄\n\n<br />\n\n둘째 줄",
    );
  });

  it("splits every stored line break into its own paragraph for the editor", () => {
    // ProseMirror 문서에는 soft break가 없다. 갈라 주지 않으면 저장된 줄바꿈이 편집기에
    // 들어가는 순간 사라져서, 여러 줄로 쓴 글이 한 줄로 보인다.
    expect(toMilkdownMarkdown("첫째 줄\n둘째 줄")).toBe("첫째 줄\n\n둘째 줄");
    expect(toMilkdownMarkdown("첫째 줄\n\n둘째 줄")).toBe(
      "첫째 줄\n\n<br />\n\n둘째 줄",
    );
    // 편집기에서 돌아오는 값은 다시 저장 형식이 된다.
    expect(fromPostEditorMarkdown(toMilkdownMarkdown("첫째 줄\n둘째 줄"))).toBe(
      "첫째 줄\n둘째 줄",
    );
    expect(
      fromPostEditorMarkdown(toMilkdownMarkdown("첫째 줄\n\n둘째 줄")),
    ).toBe("첫째 줄\n\n둘째 줄");
  });

  it("renders only intentional blank lines with an empty-line marker", () => {
    expect(toPostRenderMarkdown("첫째 줄\n둘째 줄")).toBe("첫째 줄\n둘째 줄");
    expect(toPostRenderMarkdown("첫째 줄\n\n둘째 줄")).toBe(
      "첫째 줄\n\n\u200b\n\n둘째 줄",
    );
  });
});

describe("underline", () => {
  it("round-trips underline with nested formatting and mentions", () => {
    expect(sanitizePostMarkdown(":u[밑줄 **굵게**] 끝")).toBe(
      ":u[밑줄 **굵게**] 끝",
    );
    expect(sanitizePostMarkdown(":u[[@홍길동](m:1)]")).toBe(
      ":u[[@홍길동](m:1)]",
    );
    expect(extractPostPlainText(":u[밑줄] 끝")).toBe("밑줄 끝");
  });

  it("drops attributes and keeps a following brace as text", () => {
    expect(sanitizePostMarkdown(':u[a]{class="x"}')).toBe(":u[a]");
    expect(sanitizePostMarkdown(":u[a]{}{b}")).toBe(":u[a]{}{b}");
    expect(extractPostPlainText(":u[a]{}{b}")).toBe("a{b}");
  });

  it("keeps text that only looks like another directive", () => {
    // 지시어 문법은 `:영문`이면 다 잡는다. `:u[` 밖은 예전과 같은 글자로 남아야 한다.
    for (const source of [
      "예:abc 입니다",
      "시간 10:30am",
      "참고:abc[1]",
      "참고:abc[**1**]{x}",
      "a::b",
      "::leaf",
      ":::box",
      ":u",
      ":u[]",
    ]) {
      expect(extractPostPlainText(source)).toBe(source.replace(/\*\*/g, ""));
      expect(sanitizePostMarkdown(sanitizePostMarkdown(source))).toBe(
        sanitizePostMarkdown(source),
      );
    }
    expect(sanitizePostMarkdown("예:abc 입니다")).toBe("예:abc 입니다");
    // 원래 Markdown 직렬화가 하던 escape 그대로다.
    expect(sanitizePostMarkdown("참고:abc[**1**]")).toBe(
      String.raw`참고:abc\[**1**]`,
    );
  });

  it("keeps links and formatting that follow a directive-like prefix", () => {
    // 지시어 라벨이 `[a]`를 먼저 가져가면 링크가 깨진다. 예전 출력과 같아야 한다.
    expect(sanitizePostMarkdown("x:y[a](http://b.com)")).toBe(
      "x:y[a](http://b.com)",
    );
    expect(sanitizePostMarkdown("a:b[:c[x] **y**]")).toBe(
      String.raw`a:b\[:c\[x] **y**]`,
    );
  });

  it("escapes a literal `:u` followed by a link", () => {
    const source = String.raw`글자 \:u[@한별](m:1)`;
    expect(sanitizePostMarkdown(source)).toBe(source);
  });

  it("does not escape colons in mention destinations", () => {
    expect(sanitizePostMarkdown("[@홍길동](m:1) 이모티콘 :smile:")).toBe(
      "[@홍길동](m:1) 이모티콘 :smile:",
    );
  });

  it("escapes literal underline syntax written as text", () => {
    const safe = sanitizePostMarkdown(String.raw`\:u[글자]`);
    expect(safe).toBe(String.raw`\:u\[글자]`);
    expect(extractPostPlainText(safe)).toBe(":u[글자]");
  });
});

describe("strikethrough", () => {
  it("stays closed next to Korean letters and punctuation", () => {
    const safe = sanitizePostMarkdown("&#xAC00;~~(나)~~&#xB2E4; 가~~나~~다");

    expect(safe).toBe("&#xAC00;~~(나)~~&#xB2E4; 가~~나~~다");
    expect(extractPostPlainText(safe)).toBe("가(나)다 가나다");
  });
});

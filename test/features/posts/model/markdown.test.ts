import { describe, expect, it } from "vitest";

import {
  extractPostPlainText,
  fromPostEditorMarkdown,
  normalizePostMarkdownSource,
  parsePostMarkdown,
  sanitizePostMarkdown,
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

  it("renders only intentional blank lines with an empty-line marker", () => {
    expect(toPostRenderMarkdown("첫째 줄\n둘째 줄")).toBe("첫째 줄\n둘째 줄");
    expect(toPostRenderMarkdown("첫째 줄\n\n둘째 줄")).toBe(
      "첫째 줄\n\n\u200b\n\n둘째 줄",
    );
  });
});

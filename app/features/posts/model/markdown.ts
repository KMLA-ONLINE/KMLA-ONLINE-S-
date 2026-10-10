import type { Content, PhrasingContent, Root, RootContent, Text } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

import { isMentionHref } from "~/features/posts/model/mentions";
import {
  remarkPostUnderline,
  UNDERLINE_DIRECTIVE,
} from "~/features/posts/model/underline";

const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkPostUnderline);
const serializer = unified()
  .use(remarkStringify, {
    bullet: "-",
    emphasis: "*",
    fences: false,
    listItemIndent: "one",
    strong: "*",
  })
  .use(remarkGfm)
  .use(remarkPostUnderline);

/** 밑줄 플러그인은 파싱 뒤 변환 단계에서 원문을 보고 밑줄 아닌 지시어를 되돌린다. `parse`만으로는 그 단계가 돌지 않는다. */
function parse(markdown: string): Root {
  return parser.runSync(parser.parse(markdown), markdown) as Root;
}

const EMPTY_LINE_MARKER = "<br />";

function isEmptyLineMarker(value: string): boolean {
  return /^<br\s*\/?\s*>$/i.test(value.trim());
}

function isSafeLink(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      /^https?:\/\//i.test(value)
    );
  } catch {
    return false;
  }
}

function text(value: string): Text {
  return { type: "text", value };
}

function inline(nodes: Content[]): PhrasingContent[] {
  return nodes.flatMap((node): PhrasingContent[] => {
    switch (node.type) {
      case "text":
      case "break":
        return [node];
      case "strong":
      case "emphasis":
      case "delete":
        return [{ ...node, children: inline(node.children) }];
      case "textDirective": {
        // 파서는 `:u[`만 지시어로 읽는다(`model/underline.ts`). 다른 이름이 오면 직렬화가 그
        // 이름을 그대로 `:이름[…]`로 쓰지 않도록 글자만 남긴다.
        const children = inline(node.children);
        return node.name === UNDERLINE_DIRECTIVE
          ? [{ ...node, attributes: {}, children }]
          : children;
      }
      case "link": {
        const children = inline(node.children);
        // 멘션은 CommonMark 링크 모양으로 저장한다(`model/mentions.ts`). 주소가 HTTP(S)가
        // 아니라 여기서 함께 통과시키지 않으면 정화가 링크를 풀어 멘션이 평문이 된다.
        return isSafeLink(node.url) || isMentionHref(node.url)
          ? [{ ...node, url: node.url, children }]
          : children;
      }
      case "image":
        return node.alt ? [text(node.alt)] : [];
      case "inlineCode":
        return [text(node.value)];
      case "html":
        return [];
      default:
        return "children" in node ? inline(node.children) : [];
    }
  });
}

function blockText(node: Content): PhrasingContent[] {
  if (node.type === "code") return [text(node.value)];
  if (node.type === "html") return [];
  if ("children" in node) return inline(node.children);
  return [];
}

function blocks(nodes: RootContent[]): RootContent[] {
  return nodes.flatMap((node): RootContent[] => {
    if (node.type === "paragraph")
      return [{ type: "paragraph", children: inline(node.children) }];
    if (node.type === "heading") {
      const children = inline(node.children);
      return node.depth === 2 || node.depth === 3
        ? [{ type: "heading", depth: node.depth, children }]
        : [{ type: "paragraph", children }];
    }
    if (node.type === "blockquote") return blocks(node.children);
    if (node.type === "list")
      return node.children.flatMap((item) => blocks(item.children));
    if (node.type === "table")
      return node.children.flatMap((row) =>
        row.children.map((cell) => ({
          type: "paragraph" as const,
          children: inline(cell.children),
        })),
      );
    if (node.type === "code")
      return [{ type: "paragraph", children: [text(node.value)] }];
    if (node.type === "html")
      return isEmptyLineMarker(node.value)
        ? [{ type: "html", value: EMPTY_LINE_MARKER }]
        : [];
    if (node.type === "thematicBreak") return [];
    const children = blockText(node);
    return children.length ? [{ type: "paragraph", children }] : [];
  });
}

export function parsePostMarkdown(markdown: string): Root {
  const parsed = parse(markdown);
  return { type: "root", children: blocks(parsed.children) };
}

export function sanitizePostMarkdown(markdown: string): string {
  const editorSource = toPostEditorMarkdown(
    normalizePostMarkdownSource(markdown),
  );
  const parsed = parse(editorSource);
  const safe = serializer.stringify({
    type: "root",
    children: blocks(parsed.children),
  });
  return fromPostEditorMarkdown(safe);
}

export function normalizePostMarkdownSource(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n").trim();
}

export function toPostEditorMarkdown(markdown: string): string {
  return normalizePostMarkdownSource(markdown).replace(
    /\n{2,}/g,
    (breaks) =>
      `\n\n${Array.from(
        { length: breaks.length - 1 },
        () => `${EMPTY_LINE_MARKER}\n\n`,
      ).join("")}`,
  );
}

/** Milkdown(ProseMirror)에 넣을 Markdown. 편집기에는 soft break 노드가 없어 들어갈 때만 줄바꿈 하나도 문단으로 가른다. */
export function toMilkdownMarkdown(markdown: string): string {
  return normalizePostMarkdownSource(markdown).replace(
    /\n+/g,
    (breaks) =>
      `\n\n${Array.from(
        { length: breaks.length - 1 },
        () => `${EMPTY_LINE_MARKER}\n\n`,
      ).join("")}`,
  );
}

export function fromPostEditorMarkdown(markdown: string): string {
  return normalizePostMarkdownSource(markdown)
    .split(/\n{2}/)
    .map((block) => (isEmptyLineMarker(block) ? "" : block))
    .join("\n");
}

export function toPostRenderMarkdown(markdown: string): string {
  return toPostEditorMarkdown(sanitizePostMarkdown(markdown)).replace(
    /^<br \/>$/gm,
    "\u200b",
  );
}

export function extractPostPlainText(markdown: string): string {
  const root = parsePostMarkdown(markdown);
  return root.children
    .map((node) => {
      const values: string[] = [];
      const collect = (child: Content) => {
        if (child.type === "text") values.push(child.value);
        else if (child.type === "break") values.push("\n");
        else if ("children" in child)
          (child.children as Content[]).forEach(collect);
      };
      collect(node);
      return values.join("");
    })
    .filter(Boolean)
    .join("\n\n");
}

export function isSafePostLink(value: string): boolean {
  return isSafeLink(value);
}

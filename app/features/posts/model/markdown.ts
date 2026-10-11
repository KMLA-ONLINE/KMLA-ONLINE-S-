import type { Content, PhrasingContent, Root, RootContent, Text } from "mdast";
import remarkCjkFriendly from "remark-cjk-friendly/bidi";
import remarkCjkFriendlyStrikethrough from "remark-cjk-friendly-gfm-strikethrough/bidi";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified, type Pluggable } from "unified";

import { isMentionHref } from "~/features/posts/model/mentions";
import {
  remarkPostUnderline,
  UNDERLINE_DIRECTIVE,
} from "~/features/posts/model/underline";

/**
 * 게시물 Markdown 문법. 정화·읽기 화면이 함께 쓰고, 편집기(Milkdown)도 같은 플러그인을 단다.
 *
 * CJK 플러그인은 CommonMark가 `**끝.**다음`처럼 문장부호와 한글이 붙은 자리에서 `**`·`*`·`~~`를
 * 닫지 않는 규칙을 한중일 글자 옆에서만 푼다(`docs/CONTENT_FORMATTING.md`). 직렬화도 같은 규칙을 써서
 * 그 자리를 문자 참조 없이 그대로 쓴다. 한 곳에서만 빼면 저장된 `**`가 글자로 보인다.
 */
export const postMarkdownPlugins: Pluggable[] = [
  remarkGfm,
  remarkCjkFriendly,
  remarkCjkFriendlyStrikethrough,
  remarkPostUnderline,
];

const parser = unified().use(remarkParse).use(postMarkdownPlugins);
const serializer = unified()
  .use(remarkStringify, {
    bullet: "-",
    emphasis: "*",
    fences: false,
    listItemIndent: "one",
    strong: "*",
  })
  .use(postMarkdownPlugins);

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

/**
 * 줄 머리·끝 공백을 걷는다. Markdown 파서도 원래 버리는 공백인데, 편집기가 넘긴 그대로 직렬화하면
 * 표준 규칙이 `&#x20;`로 바꿔 저장하고 공백뿐인 본문이 빈 글이 아니게 된다.
 */
function trimEdges(children: PhrasingContent[]): PhrasingContent[] {
  // 편집기의 문단은 저장할 때 한 줄로 이어 붙어 한 문단 안의 줄바꿈이 되므로, 그 앞뒤 공백도 줄 끝이다.
  const result = children.map((node) =>
    node.type === "text"
      ? { ...node, value: node.value.replace(/[ \t]*\n[ \t]*/g, "\n") }
      : node,
  );
  const first = result[0];
  if (first?.type === "text")
    result[0] = { ...first, value: first.value.replace(/^[ \t]+/, "") };
  const last = result.at(-1);
  if (last?.type === "text")
    result[result.length - 1] = {
      ...last,
      value: last.value.replace(/[ \t]+$/, ""),
    };
  return result.filter((node) => node.type !== "text" || node.value !== "");
}

function blocks(nodes: RootContent[]): RootContent[] {
  return nodes.flatMap((node): RootContent[] => {
    if (node.type === "paragraph")
      return [
        { type: "paragraph", children: trimEdges(inline(node.children)) },
      ];
    if (node.type === "heading") {
      const children = trimEdges(inline(node.children));
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

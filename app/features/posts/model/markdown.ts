import type { Content, PhrasingContent, Root, RootContent, Text } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

const parser = unified().use(remarkParse).use(remarkGfm);
const serializer = unified()
  .use(remarkStringify, {
    bullet: "-",
    emphasis: "*",
    fences: false,
    listItemIndent: "one",
    strong: "*",
  })
  .use(remarkGfm);

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
      case "link": {
        const children = inline(node.children);
        return isSafeLink(node.url)
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
  const parsed = parser.parse(markdown);
  return { type: "root", children: blocks(parsed.children) };
}

export function sanitizePostMarkdown(markdown: string): string {
  const editorSource = toPostEditorMarkdown(
    normalizePostMarkdownSource(markdown),
  );
  const parsed = parser.parse(editorSource);
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

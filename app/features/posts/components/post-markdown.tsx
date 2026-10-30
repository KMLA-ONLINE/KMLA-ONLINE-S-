import {
  Children,
  type ClipboardEvent,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";

import { MentionChip } from "~/features/posts/components/mention-chip";
import {
  postMarkdownPlugins,
  toPostRenderMarkdown,
} from "~/features/posts/model/markdown";
import {
  isMentionHref,
  mentionOrdinalFromHref,
  mentionsByOrdinal,
  type PostMention,
} from "~/features/posts/model/mentions";
import { ContentLink } from "~/shared/components/content-link";
import { cn } from "~/shared/lib/utils";

const allowedElements = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "u",
  "h2",
  "h3",
  "a",
];

/** 멘션은 `m:1` 모양 링크로 저장하므로(`model/mentions.ts`) 그 주소만 통과시킨다. 나머지는 기본 동작에 맡겨 `javascript:`가 새지 않게 한다. */
function transformUrl(url: string): string {
  if (isMentionHref(url)) return url;
  return defaultUrlTransform(url);
}

/** 대상을 못 찾았을 때 그릴 이름. 이름에 Markdown 문자가 섞이면 링크 안쪽이 중첩 노드가 되므로 텍스트를 모아 쓴다. */
function mentionFallbackLabel(label: ReactNode): string {
  const text = Children.toArray(label)
    .map((child) => (typeof child === "string" ? child : ""))
    .join("");
  return text.replace(/^@/, "");
}

function Paragraph({
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"p"> & { node?: unknown }) {
  return <p {...props} className="whitespace-pre-wrap" />;
}

/** 선택한 본문의 평문. 블록은 줄바꿈 하나로, `<br>`은 줄바꿈으로 잇고 빈 줄 자리의 `\u200b`는 지운다. */
function copiedPlainText(fragment: DocumentFragment): string {
  const lines: string[] = [];
  let inline = "";
  const inlineText = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeName === "BR") return "\n";
    return Array.from(node.childNodes, inlineText).join("");
  };
  // react-markdown은 블록 사이에 `\n` 글자 노드를 끼운다. 블록 밖의 공백만 있는 조각은 줄이 아니다.
  const flush = () => {
    if (inline.trim()) lines.push(inline);
    inline = "";
  };
  for (const node of Array.from(fragment.childNodes)) {
    if (["P", "H2", "H3"].includes(node.nodeName)) {
      flush();
      lines.push(inlineText(node));
    } else {
      inline += inlineText(node);
    }
  }
  flush();
  return lines.join("\n").replaceAll("\u200b", "");
}

/**
 * 읽기 화면은 원문의 빈 줄을 빈 문단으로 그린다(`toPostRenderMarkdown()`). 브라우저 기본 복사는
 * 문단 사이를 빈 줄로 이어서 다른 곳에 붙이면 빈 줄 하나가 세 줄이 된다. 편집기 복사와 같은 규칙으로
 * 평문만 바꾸고 HTML은 선택한 그대로 싣는다. 본문 밖까지 걸친 선택은 브라우저에 맡긴다.
 */
function copyPostText(event: ClipboardEvent<HTMLDivElement>) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
  const range = selection.getRangeAt(0);
  if (!event.currentTarget.contains(range.commonAncestorContainer)) return;
  const fragment = range.cloneContents();
  const html = document.createElement("div");
  html.append(fragment.cloneNode(true));
  event.preventDefault();
  event.clipboardData.setData("text/plain", copiedPlainText(fragment));
  event.clipboardData.setData("text/html", html.innerHTML);
}

export function PostMarkdown({
  children,
  className,
  mentions = [],
}: {
  children: string;
  className?: string;
  /** 읽기 RPC가 본문과 함께 돌려준 멘션 대상. 없으면 토큰은 평문으로 그린다. */
  mentions?: PostMention[];
}) {
  const byOrdinal = mentionsByOrdinal(mentions);

  function Anchor({
    href,
    children: label,
    node: _node,
    ...props
  }: ComponentPropsWithoutRef<"a"> & { node?: unknown }) {
    const ordinal = href ? mentionOrdinalFromHref(href) : null;
    if (ordinal !== null) {
      return (
        <MentionChip
          mention={byOrdinal.get(ordinal) ?? null}
          fallbackLabel={mentionFallbackLabel(label)}
        />
      );
    }
    return (
      <ContentLink {...props} href={href}>
        {label}
      </ContentLink>
    );
  }

  return (
    <div className={cn("post-typography", className)} onCopy={copyPostText}>
      <ReactMarkdown
        remarkPlugins={postMarkdownPlugins}
        allowedElements={allowedElements}
        urlTransform={transformUrl}
        components={{
          a: Anchor,
          p: Paragraph,
        }}
      >
        {toPostRenderMarkdown(children)}
      </ReactMarkdown>
    </div>
  );
}

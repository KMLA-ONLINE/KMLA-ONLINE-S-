import { Children, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import { MentionChip } from "~/features/posts/components/mention-chip";
import { toPostRenderMarkdown } from "~/features/posts/model/markdown";
import {
  isMentionHref,
  mentionOrdinalFromHref,
  mentionsByOrdinal,
  type PostMention,
} from "~/features/posts/model/mentions";
import { cn } from "~/shared/lib/utils";

const allowedElements = ["p", "br", "strong", "em", "del", "h2", "h3", "a"];

/**
 * 기본 `urlTransform`은 http/https/mailto 등만 남기고 나머지 주소를 비운다. 멘션은 `m:1`
 * 모양의 링크로 저장하므로(`model/mentions.ts`) 그 하나만 통과시킨다. 다른 주소는 기본
 * 동작에 맡겨야 `javascript:` 같은 것이 그대로 새지 않는다.
 */
function transformUrl(url: string): string {
  if (isMentionHref(url)) return url;
  return defaultUrlTransform(url);
}

/**
 * 대상을 못 찾았을 때 그릴 이름.
 *
 * 링크의 안쪽은 보통 문자열 하나지만, 이름에 Markdown 문자가 섞이면 중첩 노드가 된다. 그때
 * 빈 문자열로 떨어뜨리면 `@`만 남으므로 텍스트를 모아 쓴다.
 */
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
      <a {...props} href={href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    );
  }

  return (
    <div className={cn("post-typography", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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

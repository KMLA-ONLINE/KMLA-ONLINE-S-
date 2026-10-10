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
import { remarkPostUnderline } from "~/features/posts/model/underline";
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
        remarkPlugins={[remarkGfm, remarkPostUnderline]}
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

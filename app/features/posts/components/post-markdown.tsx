import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { toPostRenderMarkdown } from "~/features/posts/model/markdown";
import { cn } from "~/shared/lib/utils";

const allowedElements = ["p", "br", "strong", "em", "del", "h2", "h3", "a"];

function ExternalLink({
  href,
  children,
  ...props
}: ComponentPropsWithoutRef<"a">) {
  return (
    <a {...props} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
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
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("post-typography", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        allowedElements={allowedElements}
        components={{
          a: ExternalLink,
          p: Paragraph,
        }}
      >
        {toPostRenderMarkdown(children)}
      </ReactMarkdown>
    </div>
  );
}

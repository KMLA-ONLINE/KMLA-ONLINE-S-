import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { sanitizePostMarkdown } from "~/features/posts/model/markdown";
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
        }}
      >
        {sanitizePostMarkdown(children)}
      </ReactMarkdown>
    </div>
  );
}

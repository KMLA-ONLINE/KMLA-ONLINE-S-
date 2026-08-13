import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { TwemojiText } from "~/features/posts/components/twemoji-text";
import { sanitizePostMarkdown } from "~/features/posts/model/markdown";
import { cn } from "~/shared/lib/utils";

const allowedElements = ["p", "br", "strong", "em", "del", "h2", "h3", "a"];

function TextWithTwemoji({
  as: Component,
  children,
}: {
  as: ElementType;
  children?: ReactNode;
}) {
  return (
    <Component>
      {typeof children === "string" ? (
        <TwemojiText>{children}</TwemojiText>
      ) : (
        children
      )}
    </Component>
  );
}

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
          p: ({ children }) => (
            <TextWithTwemoji as="p">{children}</TextWithTwemoji>
          ),
          h2: ({ children }) => (
            <TextWithTwemoji as="h2">{children}</TextWithTwemoji>
          ),
          h3: ({ children }) => (
            <TextWithTwemoji as="h3">{children}</TextWithTwemoji>
          ),
          a: ExternalLink,
        }}
      >
        {sanitizePostMarkdown(children)}
      </ReactMarkdown>
    </div>
  );
}

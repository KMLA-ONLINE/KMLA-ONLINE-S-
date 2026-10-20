import { ArrowLeftIcon } from "lucide-react";
import type { ComponentPropsWithoutRef, MouseEvent, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { useNavigate } from "react-router";
import remarkCjkFriendly from "remark-cjk-friendly/bidi";
import remarkGfm from "remark-gfm";

import { Button } from "~/shared/ui/button";

/**
 * 이용약관·개인정보 처리방침 화면. 본문은 `docs/legal/*.md` 원문을 그대로 그려서, 문서와
 * 화면이 따로 놀지 않게 한다. 로그인 여부와 상관없이 같은 독립 화면이다.
 */

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

/** 표 칸의 `<br>`만 줄바꿈으로 살린다. 그 밖의 HTML은 react-markdown 기본대로 버린다. */
function remarkBreakTags() {
  const visit = (node: MarkdownNode) => {
    node.children?.forEach((child, index, siblings) => {
      if (child.type === "html" && /^<br\s*\/?>$/i.test(child.value ?? "")) {
        siblings[index] = { type: "break" };
      } else {
        visit(child);
      }
    });
  };
  return visit;
}

function textOf(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) return children.map(textOf).join("");
  return "";
}

/** 문서 목차의 `#2-처리하는-...` 링크가 닿도록 GitHub와 같은 규칙으로 제목 id를 만든다. */
function headingId(children: ReactNode): string {
  return textOf(children)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

type LinkProps = ComponentPropsWithoutRef<"a"> & { node?: unknown };

/**
 * 문서 안 링크(`#...`)는 브라우저에 맡기지 않고 라우터로 바꾼다. 브라우저가 직접 옮기면 라우터 순번이
 * 없는 기록이 하나 쌓여서, 돌아가기가 새 탭으로 연 것으로 보고 홈으로 간다.
 */
function MarkdownLink({ node: _node, href, children, ...props }: LinkProps) {
  const navigate = useNavigate();
  // 메일 링크는 메일 앱이 받으므로 새 탭을 열 필요가 없다.
  const external = Boolean(href && /^https?:/i.test(href));

  function jumpToSection(event: MouseEvent<HTMLAnchorElement>) {
    if (!href?.startsWith("#")) return;
    event.preventDefault();
    void navigate({ hash: href }, { replace: true, preventScrollReset: true });
    document
      .getElementById(decodeURIComponent(href.slice(1)))
      ?.scrollIntoView();
  }

  return (
    <a
      {...props}
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      onClick={jumpToSection}
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  );
}

type HeadingProps = ComponentPropsWithoutRef<"h2"> & { node?: unknown };

const components = {
  h1: ({ node: _node, children, ...props }: HeadingProps) => (
    <h1 {...props} className="text-2xl font-semibold text-balance">
      {children}
    </h1>
  ),
  h2: ({ node: _node, children, ...props }: HeadingProps) => (
    <h2
      {...props}
      id={headingId(children)}
      className="mt-6 scroll-mt-4 text-lg font-semibold"
    >
      {children}
    </h2>
  ),
  h3: ({ node: _node, children, ...props }: HeadingProps) => (
    <h3
      {...props}
      id={headingId(children)}
      className="mt-4 scroll-mt-4 font-semibold"
    >
      {children}
    </h3>
  ),
  a: MarkdownLink,
  ul: ({
    node: _node,
    ...props
  }: ComponentPropsWithoutRef<"ul"> & { node?: unknown }) => (
    <ul {...props} className="list-disc space-y-1 pl-5" />
  ),
  ol: ({
    node: _node,
    ...props
  }: ComponentPropsWithoutRef<"ol"> & { node?: unknown }) => (
    <ol {...props} className="list-decimal space-y-1 pl-5" />
  ),
  table: ({
    node: _node,
    ...props
  }: ComponentPropsWithoutRef<"table"> & { node?: unknown }) => (
    // 넓은 표는 페이지가 아니라 표만 가로로 민다.
    <div className="overflow-x-auto rounded-lg border">
      <table {...props} className="w-full min-w-xl text-left text-xs" />
    </div>
  ),
  th: ({
    node: _node,
    ...props
  }: ComponentPropsWithoutRef<"th"> & { node?: unknown }) => (
    <th
      {...props}
      className="border-b bg-muted/50 px-3 py-2 align-top font-medium"
    />
  ),
  td: ({
    node: _node,
    ...props
  }: ComponentPropsWithoutRef<"td"> & { node?: unknown }) => (
    <td {...props} className="border-b px-3 py-2 align-top" />
  ),
  blockquote: ({
    node: _node,
    ...props
  }: ComponentPropsWithoutRef<"blockquote"> & { node?: unknown }) => (
    <blockquote {...props} className="border-l-2 pl-4 text-muted-foreground" />
  ),
};

export function LegalDocument({ markdown }: { markdown: string }) {
  const navigate = useNavigate();

  // 새 탭으로 열었으면 돌아갈 기록이 없으므로 홈으로 간다. React Router가 기록 순번을 `idx`에 둔다.
  function goBack() {
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (index > 0) void navigate(-1);
    else void navigate("/");
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-6 sm:py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Button variant="ghost" className="-ml-2 w-fit" onClick={goBack}>
          <ArrowLeftIcon data-icon="inline-start" />
          돌아가기
        </Button>
        <article className="flex flex-col gap-3 text-sm leading-relaxed break-keep">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkCjkFriendly, remarkBreakTags]}
            components={components}
          >
            {markdown}
          </ReactMarkdown>
        </article>
      </div>
    </main>
  );
}

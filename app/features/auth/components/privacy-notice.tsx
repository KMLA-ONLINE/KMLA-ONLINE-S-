import {
  Children,
  isValidElement,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkCjkFriendly from "remark-cjk-friendly/bidi";

import privacyNotice from "../../../../docs/legal/privacy_notice.md?raw";

/**
 * 가입 약관 단계의 개인정보 처리 안내. 문구는 `docs/legal/privacy_notice.md` 1항을 그대로 그려서
 * 문서와 화면이 따로 놀지 않게 한다. 읽고 넘어가는 고지라서 "동의"라는 말을 쓰지 않는다.
 *
 * 문서는 항목을 `- **항목**: 내용` 목록으로 쓰고, 여기서 항목·내용 목록(`dl`)으로 그린다.
 */
const [, TITLE, REST] = privacyNotice.split(/^## 1\. (.+)$/m);
const BODY = REST.split(/^## /m)[0];

type Props<Tag extends keyof React.JSX.IntrinsicElements> =
  ComponentPropsWithoutRef<Tag> & { node?: unknown };

/** `**항목**: 내용`에서 굵은 글씨를 항목으로, 나머지를 내용으로 나눈다. */
function NoticeItem({ children }: Props<"li">) {
  const [term, ...rest] = Children.toArray(children);
  const detail = rest.map((part) =>
    typeof part === "string" ? part.replace(/^:\s*/, "") : part,
  );
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-3">
      <dt className="shrink-0 font-medium sm:w-36">
        {isValidElement<{ children?: ReactNode }>(term)
          ? term.props.children
          : term}
      </dt>
      <dd className="text-muted-foreground">{detail}</dd>
    </div>
  );
}

/** 문서의 서비스 주소 링크를 앱 안의 경로로 바꾼다. 가입 중에 떠나면 입력값이 사라지므로 새 탭으로 연다. */
function NoticeLink({ node: _node, href = "", children }: Props<"a">) {
  const url = new URL(href, "https://kmla.online");
  return (
    <a
      href={url.host === "kmla.online" ? url.pathname : href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-primary underline underline-offset-2"
    >
      {children}
    </a>
  );
}

const components = {
  h3: ({ node: _node, children, ...props }: Props<"h3">) => (
    <h3 {...props} className="font-semibold">
      {children}
    </h3>
  ),
  ul: ({ node: _node, children }: Props<"ul">) => (
    <dl className="divide-y rounded-lg border text-sm">{children}</dl>
  ),
  li: ({ node: _node, children }: Props<"li">) => (
    <NoticeItem>{children}</NoticeItem>
  ),
  a: NoticeLink,
};

export function PrivacyNotice() {
  return (
    <section
      aria-labelledby="privacy-notice-title"
      className="flex flex-col gap-4 text-sm leading-relaxed"
    >
      <h2 id="privacy-notice-title" className="text-base font-semibold">
        {TITLE}
      </h2>
      <ReactMarkdown
        remarkPlugins={[remarkCjkFriendly]}
        components={components}
      >
        {BODY}
      </ReactMarkdown>
    </section>
  );
}

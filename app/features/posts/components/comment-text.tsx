import { Fragment } from "react";

import { parseCommentText } from "~/features/posts/model/comment-text";

/**
 * 댓글 본문 출력.
 *
 * 평문을 Markdown이나 HTML로 해석하지 않는다. 줄바꿈과 http(s) URL만 알아보고 허용된 요소로만
 * 그린다(콘텐츠 서식 설계 §7.3). 이모지는 기기 기본 글리프를 그대로 쓴다.
 */
export function CommentText({ children }: { children: string }) {
  const segments = parseCommentText(children);

  return (
    <p className="text-sm break-words whitespace-pre-wrap">
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {segment.type === "break" ? <br /> : null}
          {segment.type === "text" ? segment.value : null}
          {segment.type === "link" ? (
            <a
              href={segment.value}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              {segment.value}
            </a>
          ) : null}
        </Fragment>
      ))}
    </p>
  );
}

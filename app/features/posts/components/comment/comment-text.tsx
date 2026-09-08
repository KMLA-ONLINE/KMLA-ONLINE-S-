import { Fragment } from "react";

import { parseCommentText } from "~/features/posts/model/comment-text";

/**
 * 댓글 본문 출력.
 *
 * 평문을 Markdown이나 HTML로 해석하지 않는다. 줄바꿈과 http(s) URL만 알아보고 허용된 요소로만
 * 그린다(콘텐츠 서식 설계 §7.3). 이모지는 기기 기본 글리프를 그대로 쓴다.
 *
 * 감싸는 블록을 만들지 않는다 — 답글의 `@부모작성자` 칩이 본문과 같은 문단 안에서 이어져야
 * 말풍선 안에서 한 덩어리로 읽힌다.
 */
export function CommentText({ children }: { children: string }) {
  return (
    <>
      {parseCommentText(children).map((segment, index) => (
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
    </>
  );
}

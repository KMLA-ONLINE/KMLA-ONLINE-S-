import { Fragment } from "react";

import { MentionChip } from "~/features/posts/components/mention-chip";
import { parseCommentText } from "~/features/posts/model/comment-text";
import {
  mentionsByOrdinal,
  type PostMention,
} from "~/features/posts/model/mentions";

/** 댓글 본문 출력. 줄바꿈과 http(s) URL만 해석한다(콘텐츠 서식 설계 §7.3). `@부모작성자` 칩과 한 문단으로 이어지도록 감싸는 블록을 만들지 않는다. */
export function CommentText({
  children,
  mentions = [],
}: {
  children: string;
  /** 댓글 읽기 RPC 가 본문과 함께 돌려준 멘션 대상. 없으면 토큰은 평문으로 그린다. */
  mentions?: PostMention[];
}) {
  const byOrdinal = mentionsByOrdinal(mentions);

  return (
    <>
      {parseCommentText(children).map((segment, index) => (
        <Fragment key={index}>
          {segment.type === "break" ? <br /> : null}
          {segment.type === "text" ? segment.value : null}
          {segment.type === "mention" ? (
            <MentionChip
              mention={byOrdinal.get(segment.ordinal) ?? null}
              fallbackLabel={segment.label}
            />
          ) : null}
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

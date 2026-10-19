import { BanIcon, ThumbsUpIcon } from "lucide-react";
import { useRef, type Ref } from "react";

import { MessageAttachments } from "~/features/messaging/components/message-attachments";
import { MessageMention } from "~/features/messaging/components/message-mention";
import { formatReplyPreview } from "~/features/messaging/model/conversation-preview";
import {
  getEmojiOnlyMessageGraphemes,
  parseMessageText,
} from "~/features/messaging/model/message-text";
import { formatMessageTime } from "~/features/messaging/model/message-time";
import { sharedPostOf } from "~/features/messaging/model/shared-post";
import type {
  ConversationMessage,
  MessageReplyPreview,
} from "~/features/messaging/model/types";
import { PostPreviewCard } from "~/features/posts/components/post-preview-card";
import { ReactionEmoji } from "~/features/posts/components/reaction/reaction-emoji";
import { useShrinkWrap } from "~/shared/hooks/use-shrink-wrap";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";

export function MessageBubble({
  message,
  isOwn,
  highlighted = false,
  startsGroup = true,
  endsGroup = true,
  showReactions = true,
  showTimestamp = false,
  replyTarget,
  replyTargetAuthor,
  onViewReply,
  onShowReactions,
  anchorRef,
}: {
  message: ConversationMessage;
  isOwn: boolean;
  highlighted?: boolean;
  startsGroup?: boolean;
  endsGroup?: boolean;
  showReactions?: boolean;
  showTimestamp?: boolean;
  replyTarget?: MessageReplyPreview;
  replyTargetAuthor?: string;
  onViewReply?: () => void;
  /** 있으면 반응 표시가 반응한 사람을 여는 버튼이 된다. */
  onShowReactions?: () => void;
  anchorRef?: Ref<HTMLDivElement>;
}) {
  const reactions = new Map(
    message.reactions?.map(({ reaction, count }) => [reaction, count]) ?? [],
  );
  const messageBody = message.deleted ? "삭제된 메시지입니다" : message.body;
  const emojiGraphemes = getEmojiOnlyMessageGraphemes(messageBody);
  const isEmojiOnly = emojiGraphemes !== null;
  const hasReactions = showReactions && reactions.size > 0;
  const attachments = message.deleted ? [] : (message.attachments ?? []);
  // 게시물 링크 하나뿐인 메시지는 글자 버블 대신 게시물 카드로 그린다(기능 명세 §13.21). 판정은 대화
  // 목록·답장 인용과 같은 `sharedPostOf` 하나다.
  const sharedPost = sharedPostOf(
    { ...message, attachmentKind: attachments[0]?.kind },
    window.location.origin,
  );
  // 첨부만 있는 메시지는 글자 버블 없이 첨부만 그린다.
  const hasText =
    !sharedPost &&
    (Boolean(message.deleted) ||
      message.body !== "" ||
      attachments.length === 0);
  const showEdited = Boolean(message.editedAt) && !message.deleted;
  // 내 메시지의 primary 버블 위에서만 밝은 글자색을 쓴다.
  const onPrimary = isOwn && !isEmojiOnly && !message.deleted && !sharedPost;
  const replyQuote =
    replyTarget && onViewReply ? (
      <button
        type="button"
        aria-label={`${replyTargetAuthor ?? "알 수 없는 사용자"}의 원문 메시지 보기`}
        className={cn(
          // 원문이 길어도 짧은 답장의 버블을 14rem 넘게 넓히지 않는다. 버블이 본문이나 사진으로
          // 그보다 넓으면 `min-w-full`로 버블 폭을 채운다(백분율 최소 폭은 버블 폭 계산에 들지 않는다).
          "mb-1.5 block w-56 max-w-full min-w-full border-l-2 pl-2 text-left text-xs leading-4",
          onPrimary
            ? "border-primary-foreground/50 text-primary-foreground/85 hover:bg-primary-foreground/10"
            : "border-primary text-muted-foreground hover:bg-background/60",
        )}
        onClick={onViewReply}
      >
        <span className="block truncate font-semibold">
          {replyTargetAuthor ?? "알 수 없는 사용자"}
        </span>
        <span className="block truncate">
          {formatReplyPreview(replyTarget, window.location.origin)}
        </span>
      </button>
    ) : null;
  const editedMark = showEdited ? (
    <span
      className={cn(
        "ml-1.5 align-baseline text-[11px] leading-none whitespace-nowrap",
        onPrimary ? "text-primary-foreground/75" : "text-muted-foreground",
      )}
    >
      수정됨
    </span>
  ) : null;
  const timestamp = showTimestamp ? (
    <time
      dateTime={message.sentAt}
      className={cn(
        "mt-1 block text-right text-[11px] leading-none",
        onPrimary ? "text-primary-foreground/75" : "text-muted-foreground",
      )}
    >
      {formatMessageTime(message.sentAt)}
    </time>
  ) : null;
  const textBoxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  // 여러 줄 글 버블은 가장 긴 줄에 폭을 맞춘다. 첨부가 있으면 글 버블이 첨부 폭을 채우므로 줄이지 않는다.
  // 답장 인용이 바라는 14rem(`w-56`)보다는 줄이지 않는다.
  useShrinkWrap(textBoxRef, textRef, {
    enabled:
      hasText && !isEmojiOnly && !message.deleted && attachments.length === 0,
    contentKey: `${messageBody}|${showEdited}`,
    minContentRem: replyQuote ? 14 : 0,
  });
  const reactionCount = [...reactions.values()].reduce(
    (total, count) => total + count,
    0,
  );

  return (
    // 반응 표시는 버블 밑에 흐름대로 놓는다. absolute로 버블 모서리에 붙이면 짧은 메시지에서 반응이
    // 버블보다 넓을 때 대화 바깥쪽으로 삐져나가 가로 스크롤이 생긴다. 흐름 안에 두면 이 묶음이
    // 넓어지는데, 묶음은 화면 가장자리 쪽에 붙어 있으므로 대화 중앙 쪽으로만 넓어진다.
    <div
      className={cn(
        "flex max-w-full min-w-0 flex-col",
        isOwn ? "items-end" : "items-start",
      )}
    >
      <div
        ref={anchorRef}
        data-slot="message-bubble"
        className={cn(
          "relative w-fit max-w-full min-w-0",
          highlighted &&
            (isEmojiOnly
              ? "rounded-full"
              : cn(
                  "rounded-2xl",
                  !startsGroup && isOwn && "rounded-tr-md",
                  !startsGroup && !isOwn && "rounded-tl-md",
                  !endsGroup && isOwn && "rounded-br-md",
                  !endsGroup && !isOwn && "rounded-bl-md",
                )),
          highlighted &&
            "ring-1 ring-primary ring-offset-1 ring-offset-background",
        )}
      >
        {attachments.length > 0 ? (
          <MessageAttachments
            attachments={attachments}
            isOwn={isOwn}
            pending={message.pending}
          />
        ) : null}
        {sharedPost ? (
          <>
            {/* 답장 인용은 카드 위 옅은 띠에 둔다. 카드 안에 넣으면 카드 전체가 링크라 누를 곳이 겹친다. */}
            {replyQuote ? (
              <div className="mb-1 w-fit max-w-full rounded-2xl bg-muted px-3.5 pt-2 pb-0.5">
                {replyQuote}
              </div>
            ) : null}
            <PostPreviewCard
              postId={sharedPost.postId}
              path={sharedPost.path}
            />
            {editedMark || timestamp ? (
              <div className={cn("mt-1", isOwn ? "text-right" : "text-left")}>
                {editedMark}
                {timestamp}
              </div>
            ) : null}
          </>
        ) : null}
        {hasText ? (
          <div
            ref={textBoxRef}
            className={cn(
              // 줄여 둔 폭이 남은 채 옆에 액션 레일이 생기는 식으로 쓸 수 있는 폭이 줄어도 버블 밖으로
              // 넘치지 않게 막는다. 넘치면 대화 영역에 가로 스크롤이 생긴다.
              "w-full max-w-full",
              isEmojiOnly
                ? "px-1 py-0.5 text-5xl leading-none"
                : "rounded-2xl px-3.5 py-2 text-[15px] [overflow-wrap:anywhere] break-keep whitespace-pre-wrap",
              // 삭제된 메시지는 같은 문구를 보낸 메시지와 헷갈리지 않게 배경 없이 연한 점선 테두리와
              // 흐린 글씨로 그린다. 내 메시지와 상대 메시지가 같은 모양이다.
              !isEmojiOnly &&
                (message.deleted
                  ? // 테두리 1px만큼 위아래 여백을 줄여 다른 버블과 높이를 맞춘다.
                    "border border-dashed border-muted-foreground/40 bg-transparent py-[7px] text-muted-foreground"
                  : isOwn
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"),
              !isEmojiOnly && !startsGroup && isOwn && "rounded-tr-md",
              !isEmojiOnly && !startsGroup && !isOwn && "rounded-tl-md",
              !isEmojiOnly && !endsGroup && isOwn && "rounded-br-md",
              !isEmojiOnly && !endsGroup && !isOwn && "rounded-bl-md",
            )}
          >
            {replyQuote}
            {message.deleted ? (
              // inline-flex는 바깥 줄의 글자 기준선에 얹혀 아래에 빈 줄 높이가 남아 글이 위로 뜬다.
              <span className="flex items-center gap-1.5">
                <BanIcon aria-hidden className="size-3.5 shrink-0" />
                {messageBody}
              </span>
            ) : isEmojiOnly ? (
              <EmojiOnlyMessageBody graphemes={emojiGraphemes} />
            ) : (
              <span ref={textRef}>
                <MessageBody
                  body={messageBody}
                  isOwn={isOwn}
                  mentionProfileIds={message.mentionProfileIds}
                />
                {editedMark}
              </span>
            )}
            {isEmojiOnly ? editedMark : null}
            {timestamp}
          </div>
        ) : null}
      </div>
      {hasReactions ? (
        <Badge
          render={
            onShowReactions ? (
              <button
                type="button"
                aria-label={`반응 ${reactionCount}개, 반응한 사람 보기`}
                onClick={onShowReactions}
              />
            ) : undefined
          }
          variant="secondary"
          className={cn(
            // `relative`가 없으면 positioned인 버블이 나중에 칠해져 반응 표시를 덮는다.
            "relative -mt-2 h-6 gap-1 rounded-full border-2 border-background px-1.5 text-xs shadow-none",
            // 누를 자리를 아래와 옆으로 넓힌다. 위로 넓히면 버블(사진)을 누를 자리를 가린다.
            onShowReactions &&
              "overflow-visible after:absolute after:-inset-x-1.5 after:top-0 after:-bottom-3",
            isOwn ? "ml-1 self-start" : "mr-1 self-end",
          )}
        >
          {[...reactions].map(([reaction]) => (
            <span key={reaction} className="flex items-center">
              <ReactionEmoji
                reaction={reaction}
                labelled
                className="size-[13px]"
              />
            </span>
          ))}
          {reactionCount > 1 ? (
            // 반응 표시는 버블 밖의 secondary 배경이다. 버블 글자색(primary-foreground)을 쓰면 내 메시지에서
            // 배경과 같은 밝기가 되어 숫자가 보이지 않는다.
            <span className="font-normal text-muted-foreground">
              {reactionCount}
            </span>
          ) : null}
        </Badge>
      ) : null}
    </div>
  );
}

function EmojiOnlyMessageBody({ graphemes }: { graphemes: string[] }) {
  if (graphemes.length === 1 && graphemes[0] === "👍") {
    return (
      <span aria-label="좋아요" className="inline-flex text-primary">
        <ThumbsUpIcon aria-hidden className="size-[1em]" />
      </span>
    );
  }

  return <>{graphemes.join("")}</>;
}

function MessageBody({
  body,
  isOwn,
  mentionProfileIds,
}: {
  body: string;
  isOwn: boolean;
  mentionProfileIds: string[] | undefined;
}) {
  return parseMessageText(body).map((segment, index) => {
    if (segment.type === "mention") {
      return (
        <MessageMention
          key={`mention-${index}`}
          ordinal={segment.ordinal}
          label={segment.label}
          mentionProfileIds={mentionProfileIds}
          onPrimary={isOwn}
        />
      );
    }
    if (segment.type === "link") {
      return (
        <a
          key={`${segment.value}-${index}`}
          href={segment.value}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "underline underline-offset-2",
            isOwn ? "text-primary-foreground" : "text-primary",
          )}
        >
          {segment.value}
        </a>
      );
    }
    return segment.value;
  });
}

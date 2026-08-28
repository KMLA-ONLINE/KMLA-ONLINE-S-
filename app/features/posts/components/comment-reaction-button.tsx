import { SmilePlusIcon } from "lucide-react";
import { useState } from "react";

import {
  QuickReactionBar,
  ReactionPickerSurface,
} from "~/features/posts/components/quick-reaction-bar";
import { ReactionEmoji } from "~/features/posts/components/reaction-emoji";
import { reactionLabel } from "~/features/posts/model/reactions";
import type {
  PostReaction,
  ReactionSummary,
} from "~/features/posts/model/types";

/**
 * 댓글 반응.
 *
 * 게시물 버튼과 달리 롱프레스가 없다. 누르면 바로 종류를 고르는 줄이 뜨고, 이미 고른 게 있으면
 * 그 자리에서 해제한다 — 댓글 줄의 아이콘은 손가락으로 정확히 누르기에 작아서, 짧게/길게를
 * 나누면 해제하려다 피커가 열리는 일이 잦다.
 *
 * 남들이 뭘 눌렀는지는 여기 붙이지 않는다. `CommentReactionSummary`가 줄 반대편에서 맡는다.
 */
export function CommentReactionButton({
  summary,
  onSelect,
  onClear,
}: {
  summary: ReactionSummary;
  onSelect: (reaction: PostReaction) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const mine = summary.my_reaction;

  return (
    <div className="relative flex">
      {open ? (
        <ReactionPickerSurface
          onDismiss={() => setOpen(false)}
          className="mb-1"
        >
          <QuickReactionBar
            current={mine}
            onSelect={(reaction) => {
              setOpen(false);
              if (reaction === mine) onClear();
              else onSelect(reaction);
            }}
          />
        </ReactionPickerSurface>
      ) : null}

      <button
        type="button"
        aria-label={mine ? `${reactionLabel(mine)} 취소` : "반응 남기기"}
        aria-pressed={mine !== null}
        className="flex items-center hover:text-foreground"
        onClick={() => {
          if (mine) onClear();
          else setOpen(true);
        }}
      >
        {mine ? (
          <ReactionEmoji reaction={mine} className="text-sm" />
        ) : (
          <SmilePlusIcon className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

/**
 * 댓글에 달린 반응 요약. 줄의 오른쪽 끝에 붙어 누르면 참여자 목록이 열린다.
 *
 * 반응 버튼 바로 옆에 두면 내가 고른 이모지와 남들의 이모지가 맞붙어 어느 쪽이 내 것인지
 * 읽히지 않는다. 종류도 가장 많이 쓰인 하나만 보여준다 — 댓글 줄은 세 개를 늘어놓을 자리가 아니고,
 * 나머지는 목록을 열면 종류별로 다 나온다.
 */
export function CommentReactionSummary({
  summary,
  onOpen,
}: {
  summary: ReactionSummary;
  onOpen: () => void;
}) {
  const top = summary.top_reactions[0];
  if (summary.reaction_count === 0 || !top) return null;

  return (
    <button
      type="button"
      aria-label={`반응 ${summary.reaction_count}개 보기`}
      className="ml-auto flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 tabular-nums transition-colors hover:bg-muted hover:text-foreground"
      onClick={onOpen}
    >
      <ReactionEmoji reaction={top} labelled className="text-sm" />
      {summary.reaction_count}
    </button>
  );
}

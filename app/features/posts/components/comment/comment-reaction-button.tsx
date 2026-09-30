import { SmilePlusIcon } from "lucide-react";
import { useState } from "react";

import {
  QuickReactionBar,
  ReactionPickerSurface,
} from "~/features/posts/components/reaction/quick-reaction-bar";
import { ReactionEmoji } from "~/features/posts/components/reaction/reaction-emoji";
import { reactionLabel } from "~/features/posts/model/reactions";
import type {
  PostReaction,
  ReactionSummary,
} from "~/features/posts/model/types";

/** 댓글 반응. 롱프레스 없이 누르면 바로 종류 줄이 뜨고, 고른 게 있으면 해제한다 — 작은 아이콘에서 짧게/길게 구분이 어렵다. */
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

/** 댓글 반응 요약. 내 반응과 붙으면 구분이 안 돼 줄 끝에 두고, 가장 많은 종류 하나만 보여준다. */
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

import {
  reactionAssetPath,
  reactionLabel,
} from "~/features/posts/model/reactions";
import type { PostReaction } from "~/features/posts/model/types";
import { cn } from "~/shared/lib/utils";

/**
 * 반응 그래픽 한 개.
 *
 * 크기를 `em`으로 잡아 두면 부모의 `text-sm`/`text-2xl`만 바꿔도 따라 커진다. 기기 이모지를
 * 글자로 그리던 자리에 그대로 끼워 넣기 위한 것이다.
 *
 * 기본은 장식이다 — 감싸는 버튼이 `aria-label`로 이름을 말하므로 여기서 또 읽으면 "좋아요
 * 좋아요"가 된다. 그림만 있고 옆에 이름이 없는 자리에서는 `labelled`를 켠다.
 */
export function ReactionEmoji({
  reaction,
  labelled = false,
  className,
}: {
  reaction: PostReaction;
  labelled?: boolean;
  className?: string;
}) {
  return (
    <img
      src={reactionAssetPath(reaction)}
      alt={labelled ? reactionLabel(reaction) : ""}
      aria-hidden={labelled ? undefined : "true"}
      draggable={false}
      className={cn("size-[1.125em] shrink-0 select-none", className)}
    />
  );
}

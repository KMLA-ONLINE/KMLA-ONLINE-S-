import {
  reactionAssetPath,
  reactionLabel,
} from "~/features/posts/model/reactions";
import type { PostReaction } from "~/features/posts/model/types";
import { cn } from "~/shared/lib/utils";

/** 반응 그래픽 한 개. 크기는 `em`이라 부모 글자 크기를 따른다. 기본은 장식이고, 이름이 옆에 없으면 `labelled`를 켠다. */
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

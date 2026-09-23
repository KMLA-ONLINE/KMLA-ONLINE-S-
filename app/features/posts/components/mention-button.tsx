import { AtSignIcon } from "lucide-react";
import { useState } from "react";

import { MentionPickerDialog } from "~/features/posts/components/mention-picker-dialog";
import type { MentionCandidate } from "~/features/posts/model/mentions";
import { Button } from "~/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/shared/ui/tooltip";

/**
 * 멘션 버튼과 그것이 여는 후보 시트(기능 명세 §8.14).
 *
 * 게시물 편집기(데스크톱·모바일)와 댓글 입력창이 함께 쓴다. 고른 뒤 어디에 넣을지는 부르는
 * 쪽이 정한다 — 편집기마다 커서를 다루는 방식이 다르기 때문이다.
 */
export function MentionButton({
  groupId,
  remaining,
  activeTargetPubIds,
  disabled = false,
  onSelect,
  className,
}: {
  groupId: string;
  /** 더 부를 수 있는 사람 수. 0이면 눌러도 고를 수 없다는 안내만 보인다. */
  remaining: number;
  activeTargetPubIds: string[];
  disabled?: boolean;
  onSelect: (candidate: MentionCandidate) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="멘션"
              disabled={disabled}
              className={className}
              onClick={() => setOpen(true)}
            >
              <AtSignIcon />
            </Button>
          }
        />
        <TooltipContent>멘션</TooltipContent>
      </Tooltip>
      {/* 열려 있는 동안에만 마운트한다. 그래야 다시 열 때 지난 검색어가 남지 않는다. */}
      {open ? (
        <MentionPickerDialog
          groupId={groupId}
          onOpenChange={setOpen}
          remaining={remaining}
          activeTargetPubIds={activeTargetPubIds}
          onSelect={(candidate) => {
            setOpen(false);
            onSelect(candidate);
          }}
        />
      ) : null}
    </>
  );
}

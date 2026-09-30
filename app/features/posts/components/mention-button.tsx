import { AtSignIcon } from "lucide-react";
import { useState } from "react";

import { MentionPickerDialog } from "~/features/posts/components/mention-picker-dialog";
import type { MentionCandidate } from "~/features/posts/model/mentions";
import { Button } from "~/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/shared/ui/tooltip";

/** 멘션 버튼과 후보 시트(기능 명세 §8.14). 넣을 자리는 입력기마다 달라 부르는 쪽이 정한다. */
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
      {/* 열려 있을 때만 마운트해 지난 검색어를 지운다. */}
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

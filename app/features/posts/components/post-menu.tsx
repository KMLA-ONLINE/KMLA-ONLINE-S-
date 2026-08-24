import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { GroupPostReportDialog } from "~/features/posts/components/group-post-report-dialog";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";

/**
 * 게시물 카드와 상세가 함께 쓰는 ⋯ 메뉴.
 *
 * 권한 플래그는 RPC가 내려준 `can_edit`/`can_pin`/`can_delete`를 그대로 받는다. 클라이언트가
 * 역할을 다시 계산하지 않는다 — 실제 판정은 RLS와 RPC 안에 있고, 여기서 한 번 더 계산하면
 * 두 규칙이 언젠가 갈라진다.
 *
 * 고정은 그룹 게시물에만 있다(기능 명세 §8.1). 개인 게시물은 고정 관련 props를 넘기지 않고,
 * 그러면 고정 항목 자체가 그려지지 않는다.
 */
export function PostMenu({
  editTo,
  isPinned = false,
  canEdit,
  canPin = false,
  canDelete,
  canReport = false,
  reportPostId,
  onPin,
  onDelete,
}: {
  editTo: string;
  isPinned?: boolean;
  canEdit: boolean;
  canPin?: boolean;
  canDelete: boolean;
  canReport?: boolean;
  reportPostId?: string;
  onPin?: () => void;
  onDelete: () => void;
}) {
  // 확인 dialog는 menu 바깥에 둔다. menu가 닫히면서 자식이 언마운트되면 dialog도 같이
  // 사라지므로, 열림 상태만 여기서 들고 dialog는 형제로 그린다.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);

  if (
    !canEdit &&
    !canPin &&
    !canDelete &&
    !(canReport && reportPostId && !reported)
  ) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              aria-label="게시물 옵션"
            />
          }
        >
          <MoreHorizontalIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit ? (
            <DropdownMenuItem render={<Link to={editTo} />}>
              수정
            </DropdownMenuItem>
          ) : null}
          {canPin ? (
            <DropdownMenuItem onClick={onPin}>
              {isPinned ? "고정 해제" : "고정"}
            </DropdownMenuItem>
          ) : null}
          {canReport && reportPostId && !reported ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setReportOpen(true)}
            >
              신고
            </DropdownMenuItem>
          ) : null}

          {canDelete ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmingDelete(true)}
            >
              삭제
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {reportPostId ? (
        <GroupPostReportDialog
          postId={reportPostId}
          open={reportOpen}
          onOpenChange={setReportOpen}
          onReported={() => setReported(true)}
        />
      ) : null}

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>게시물을 삭제할까요?</DialogTitle>
            <DialogDescription>
              삭제한 게시물과 첨부는 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmingDelete(false)}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmingDelete(false);
                onDelete();
              }}
            >
              삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

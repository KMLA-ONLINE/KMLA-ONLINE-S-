import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { GroupPostReportDialog } from "~/features/posts/components/group/group-post-report-dialog";
import { AnonymousActivityRestrictionDialog } from "~/features/posts/components/group/anonymous-activity-restriction-dialog";
import { useT } from "~/shared/i18n";
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

/** 카드와 상세가 함께 쓰는 ⋯ 메뉴. 권한은 RPC의 `can_*`를 그대로 받고 클라이언트가 다시 계산하지 않는다. 고정은 그룹 게시물에만 있다(기능 명세 §8.1). */
export function PostMenu({
  editTo,
  editState,
  isPinned = false,
  canEdit,
  canPin = false,
  canDelete,
  canReport = false,
  reportPostId,
  onPin,
  onDelete,
  onHide,
  canModerateAnonymous = false,
  anonymousAuthorRestricted = false,
  anonymousAuthorRestrictionExpiresAt = null,
  anonymousSourceId,
}: {
  editTo: string;
  /** 수정 화면 history entry의 `state`. 저장 뒤 돌아갈 곳을 알린다(`FROM_FEED`). */
  editState?: unknown;
  isPinned?: boolean;
  canEdit: boolean;
  canPin?: boolean;
  canDelete: boolean;
  canReport?: boolean;
  reportPostId?: string;
  onPin?: () => void;
  /** `canDelete`일 때만 부른다. */
  onDelete?: () => void;
  /** 이 기기에서만 접는 "가리기". 피드의 프로필 변경 활동만 넘긴다. */
  onHide?: () => void;
  canModerateAnonymous?: boolean;
  anonymousAuthorRestricted?: boolean;
  anonymousAuthorRestrictionExpiresAt?: string | null;
  anonymousSourceId?: string;
}) {
  // 확인 dialog는 menu 바깥에 둔다. menu가 닫히면서 자식이 언마운트되면 dialog도 같이
  // 사라지므로, 열림 상태만 여기서 들고 dialog는 형제로 그린다.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const [restrictionOpen, setRestrictionOpen] = useState(false);
  const [restricted, setRestricted] = useState(anonymousAuthorRestricted);
  const [restrictionExpiresAt, setRestrictionExpiresAt] = useState(
    anonymousAuthorRestrictionExpiresAt,
  );
  const canRestrict = canModerateAnonymous && Boolean(anonymousSourceId);
  const t = useT();

  if (
    !canEdit &&
    !canPin &&
    !canDelete &&
    !(canReport && reportPostId && !reported) &&
    !canRestrict &&
    !onHide
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
              aria-label={t("게시물 옵션")}
            />
          }
        >
          <MoreHorizontalIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit ? (
            <DropdownMenuItem render={<Link to={editTo} state={editState} />}>
              {t("수정")}
            </DropdownMenuItem>
          ) : null}
          {onHide ? (
            <DropdownMenuItem onClick={onHide}>{t("가리기")}</DropdownMenuItem>
          ) : null}
          {canPin ? (
            <DropdownMenuItem onClick={onPin}>
              {isPinned ? t("고정 해제") : t("고정")}
            </DropdownMenuItem>
          ) : null}
          {canReport && reportPostId && !reported ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setReportOpen(true)}
            >
              {t("신고")}
            </DropdownMenuItem>
          ) : null}
          {canRestrict ? (
            <DropdownMenuItem onClick={() => setRestrictionOpen(true)}>
              {restricted ? t("익명 차단 해제") : t("익명 활동 차단")}
            </DropdownMenuItem>
          ) : null}

          {canDelete ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmingDelete(true)}
            >
              {t("삭제")}
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
      {anonymousSourceId ? (
        <AnonymousActivityRestrictionDialog
          open={restrictionOpen}
          sourceKind="post"
          sourceId={anonymousSourceId}
          restricted={restricted}
          restrictionExpiresAt={restrictionExpiresAt}
          onOpenChange={setRestrictionOpen}
          onRestrictedChange={(nextRestricted, expiresAt) => {
            setRestricted(nextRestricted);
            setRestrictionExpiresAt(expiresAt);
          }}
        />
      ) : null}

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("게시물을 삭제할까요?")}</DialogTitle>
            <DialogDescription>
              {t("삭제한 게시물과 첨부는 되돌릴 수 없습니다.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmingDelete(false)}
            >
              {t("취소")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmingDelete(false);
                onDelete?.();
              }}
            >
              {t("삭제")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

import type { ReactNode } from "react";

import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Spinner } from "~/shared/ui/spinner";

/**
 * 되돌리기 번거로운 그룹 동작(생성, 가입 요청) 앞에 세우는 확인 단계.
 * shadcn `AlertDialog`는 이 저장소에서 쓰지 않으므로 `Dialog`로 조립한다.
 */
export function GroupConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  details,
  confirmLabel,
  confirmVariant = "default",
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  details?: ReactNode;
  confirmLabel: string;
  confirmVariant?: "default" | "destructive";
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {details}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 그룹 상세와 목록/탐색 카드가 공유하는 가입 요청 확인 단계. */
export function GroupJoinRequestDialog({
  open,
  onOpenChange,
  groupName,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupName: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <GroupConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={groupName}
      description="이 그룹에 가입을 요청할까요? 소유자나 관리자가 승인하면 멤버가 됩니다."
      confirmLabel="가입 요청"
      pending={pending}
      onConfirm={onConfirm}
    />
  );
}

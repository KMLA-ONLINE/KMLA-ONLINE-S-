import { useState, type FormEvent } from "react";

import {
  cancelGroupAnonymousActivityRestriction,
  restrictGroupAnonymousActivity,
} from "~/features/posts/data/mutations";
import { getAnonymousActivityRestrictionErrorMessage } from "~/features/posts/model/format";
import type { AnonymousActivitySourceKind } from "~/features/posts/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";
import { Textarea } from "~/shared/ui/textarea";

export function AnonymousActivityRestrictionDialog({
  open,
  sourceKind,
  sourceId,
  restricted,
  onOpenChange,
  onRestrictedChange,
}: {
  open: boolean;
  sourceKind: AnonymousActivitySourceKind;
  sourceId: string;
  restricted: boolean;
  onOpenChange: (open: boolean) => void;
  onRestrictedChange: (restricted: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [durationDays, setDurationDays] = useState("7");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (pending) return;
    setConfirming(false);
    setError(null);
    onOpenChange(false);
  };

  const prepareRestriction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedReason = reason.trim();
    const days = Number(durationDays);
    if (Array.from(normalizedReason).length < 5) {
      setError("사유를 5자 이상 입력해 주세요.");
      return;
    }
    if (Array.from(normalizedReason).length > 300) {
      setError("사유는 300자 이하로 입력해 주세요.");
      return;
    }
    if (!Number.isInteger(days) || days < 1 || days > 180) {
      setError("기간은 1일 이상 180일 이하의 정수로 입력해 주세요.");
      return;
    }
    setReason(normalizedReason);
    setError(null);
    setConfirming(true);
  };

  const restrict = async () => {
    setPending(true);
    setError(null);
    try {
      await restrictGroupAnonymousActivity(
        sourceKind,
        sourceId,
        reason,
        Number(durationDays),
      );
      onRestrictedChange(true);
      onOpenChange(false);
      setConfirming(false);
      setReason("");
      setDurationDays("7");
    } catch (cause) {
      const message = getAnonymousActivityRestrictionErrorMessage(cause);
      setError(message);
      setConfirming(false);
      if (message === "이미 익명 활동이 차단된 사용자입니다.")
        onRestrictedChange(true);
    } finally {
      setPending(false);
    }
  };

  const cancel = async () => {
    setPending(true);
    setError(null);
    try {
      await cancelGroupAnonymousActivityRestriction(sourceKind, sourceId);
      onRestrictedChange(false);
      onOpenChange(false);
      setConfirming(false);
    } catch (cause) {
      const message = getAnonymousActivityRestrictionErrorMessage(cause);
      setError(message);
      setConfirming(false);
      if (message === "이미 해제되었거나 만료된 익명 활동 차단입니다.")
        onRestrictedChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Dialog
        open={open && !confirming}
        onOpenChange={(next) => !next && close()}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>
              {restricted ? "익명 활동 차단 중" : "익명 활동 차단"}
            </DialogTitle>
            <DialogDescription>
              {restricted
                ? "이 작성자는 이미 이 그룹에서 익명 활동이 차단되어 있습니다."
                : "실제 작성자 정보는 공개되지 않으며, 이 익명 콘텐츠의 작성자에게만 적용됩니다."}
            </DialogDescription>
          </DialogHeader>

          {restricted ? (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                닫기
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={() => setConfirming(true)}
              >
                {pending ? <Spinner /> : null} 차단 취소
              </Button>
            </DialogFooter>
          ) : (
            <form className="grid gap-4" onSubmit={prepareRestriction}>
              <label
                htmlFor="anonymous-restriction-reason"
                className="grid gap-1.5 text-sm font-medium"
              >
                사유
                <Textarea
                  id="anonymous-restriction-reason"
                  value={reason}
                  minLength={5}
                  maxLength={300}
                  required
                  rows={4}
                  placeholder="차단 사유를 입력하세요."
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <label
                htmlFor="anonymous-restriction-duration"
                className="grid gap-1.5 text-sm font-medium"
              >
                기간(일)
                <Input
                  id="anonymous-restriction-duration"
                  type="number"
                  value={durationDays}
                  min={1}
                  max={180}
                  step={1}
                  required
                  onChange={(event) => setDurationDays(event.target.value)}
                />
              </label>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>
                  취소
                </Button>
                <Button type="submit">다음</Button>
              </DialogFooter>
            </form>
          )}

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>

      {confirming ? (
        <ConfirmDialog
          title={
            restricted
              ? "익명 활동 차단을 취소할까요?"
              : "익명 활동을 차단할까요?"
          }
          description={
            restricted ? (
              "이 사용자는 다시 익명 게시물과 댓글을 작성할 수 있습니다."
            ) : (
              <span className="grid gap-2">
                <span>
                  {durationDays}일 동안 익명 게시물과 댓글 작성을 막습니다.
                </span>
                <span className="line-clamp-4 break-words">사유: {reason}</span>
              </span>
            )
          }
          confirmLabel={restricted ? "차단 취소" : "차단"}
          destructive
          pending={pending}
          onCancel={() => !pending && setConfirming(false)}
          onConfirm={() => void (restricted ? cancel() : restrict())}
        />
      ) : null}
    </>
  );
}

import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";

import type {
  AdminActionResult,
  AdminApplication,
} from "~/features/admin/model/types";
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
import { Textarea } from "~/shared/ui/textarea";

// 자주 쓰는 반려 사유. 고르면 입력란을 채울 뿐이고 관리자가 그대로 고쳐 쓴다.
const REASON_TEMPLATES = [
  ["이름", "이름이 학적과 다릅니다. 실명을 확인해 주세요."],
  ["기수·학번", "기수와 학번이 맞지 않습니다. 확인해 주세요."],
  ["사용자 유형", "사용자 유형(재학생·졸업생·교사)을 확인해 주세요."],
] as const;

/**
 * 가입 반려. 한 명씩 사유를 받아 승인 화면 route action으로 보낸다. 대상이 바뀌면 호출자가
 * `key`로 다시 마운트해 입력과 이전 결과를 비운다.
 */
export function RejectionDialog({
  application,
  onOpenChange,
}: {
  application: AdminApplication | null;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher<AdminActionResult>();
  const [reason, setReason] = useState("");
  const pending = fetcher.state !== "idle";

  // 성공하면 닫는다. 목록은 route action 뒤 loader 재검증으로 갱신된다.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data?.ok) return;
    toast.success("반려했습니다.");
    onOpenChange(false);
  }, [fetcher.state, fetcher.data, onOpenChange]);

  return (
    <Dialog
      open={application !== null}
      onOpenChange={(next) => !next && !pending && onOpenChange(false)}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>가입 반려</DialogTitle>
          <DialogDescription>
            {application?.name}님은 사유를 보고 정보를 고쳐 다시 제출할 수
            있습니다. 사유는 본인에게 이메일과 학교 프로필 설정 화면으로
            공개됩니다.
          </DialogDescription>
        </DialogHeader>

        <fetcher.Form method="post" className="grid gap-4">
          <input type="hidden" name="intent" value="reject" />
          <input
            type="hidden"
            name="profileId"
            value={application?.profile_id}
          />

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="rejection-reason" className="text-sm font-medium">
                사유
              </label>
              <span
                id="rejection-reason-count"
                className="text-xs text-muted-foreground tabular-nums"
              >
                {Array.from(reason).length}/300
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {REASON_TEMPLATES.map(([label, text]) => (
                <Button
                  key={label}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setReason(text)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <Textarea
              id="rejection-reason"
              name="reason"
              aria-describedby="rejection-reason-count"
              value={reason}
              minLength={5}
              maxLength={300}
              required
              rows={4}
              placeholder="무엇을 고쳐야 하는지 적어 주세요."
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          {fetcher.data?.error && !pending ? (
            <p role="alert" className="text-sm text-destructive">
              {fetcher.data.error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              반려
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

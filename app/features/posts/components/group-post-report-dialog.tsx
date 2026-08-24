import { CheckIcon } from "lucide-react";
import { useState } from "react";

import {
  getGroupPostReportErrorMessage,
  reportGroupPost,
} from "~/features/posts/data/group-reports";
import {
  GROUP_POST_REPORT_REASON_OPTIONS,
  normalizeGroupPostReportDescription,
  type GroupPostReportReason,
  validateGroupPostReport,
} from "~/features/posts/model/group-report";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Spinner } from "~/shared/ui/spinner";

export function GroupPostReportDialog({
  postId,
  open,
  onOpenChange,
  onReported,
}: {
  postId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReported: () => void;
}) {
  const [reason, setReason] = useState<GroupPostReportReason | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const reset = () => {
    setReason(null);
    setDescription("");
    setError(null);
  };

  const close = () => {
    if (pending) return;
    reset();
    onOpenChange(false);
  };

  const submit = async () => {
    const validationError = validateGroupPostReport(reason, description);

    if (validationError) {
      setError(validationError);
      return;
    }

    if (!reason) return;

    setPending(true);
    setError(null);

    try {
      await reportGroupPost(
        postId,
        reason,
        normalizeGroupPostReportDescription(description),
      );

      reset();
      onReported();
      onOpenChange(false);
    } catch (caught) {
      setError(getGroupPostReportErrorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] gap-2.5 overflow-y-auto rounded-md p-3 sm:max-w-md [&_[data-slot=dialog-close]]:top-1">
        <DialogHeader className="gap-0 pb-2.5">
          <DialogTitle>게시물 신고</DialogTitle>
        </DialogHeader>

        <div role="radiogroup" aria-label="신고 사유" className="grid gap-0">
          {GROUP_POST_REPORT_REASON_OPTIONS.map((option) => {
            const selected = reason === option.value;

            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setReason(option.value);
                  setError(null);
                }}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-sm px-3 py-0 text-left text-sm font-medium transition-colors",
                  selected ? "bg-primary/10" : "bg-muted/30 hover:bg-muted/50",
                )}
              >
                <span className="min-w-0 flex-1">{option.label}</span>

                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/35",
                  )}
                >
                  {selected ? <CheckIcon className="size-3.5" /> : null}
                </span>
              </button>
            );
          })}
        </div>

        <div>
          <div className="mb-0.5 flex items-center justify-between">
            <label
              htmlFor="group-post-report-description"
              className="text-sm font-medium"
            >
              설명
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                {reason === "other" ? "필수" : "선택"}
              </span>
            </label>

            <span className="text-xs text-muted-foreground tabular-nums">
              {Array.from(description).length}
              /300
            </span>
          </div>

          <textarea
            id="group-post-report-description"
            value={description}
            maxLength={300}
            rows={4}
            placeholder="필요한 내용을 입력해 주세요."
            onChange={(event) => {
              setDescription(event.target.value);
              setError(null);
            }}
            className="h-24 max-h-24 min-h-24 w-full resize-none rounded-sm bg-muted/30 px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring/50"
          />

          {error ? (
            <p role="alert" className="mt-1.5 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="grid grid-cols-2 gap-1 sm:grid-cols-2">
          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-sm"
            disabled={pending}
            onClick={close}
          >
            취소
          </Button>

          <Button
            type="button"
            className="h-8 rounded-sm"
            disabled={pending}
            onClick={() => void submit()}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            신고
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useRef, type ReactNode } from "react";

import { calendarDate } from "../model/korea-date";
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
import { TextField } from "~/shared/ui/text-field";

const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  weekday: "long",
});

/** 공강과 노래방이 같이 쓰는 한 자리 신청 팝업. 모드마다 다른 건 입력 이름과 아래 옵션뿐이다. */
export function UtilityBookingDialog({
  title,
  date,
  fieldLabel,
  detail,
  onDetailChange,
  children,
  error,
  busy,
  submitLabel,
  busyLabel,
  destructive = false,
  onSubmit,
  onClose,
}: {
  title: string;
  date: string;
  fieldLabel: string;
  detail: string;
  onDetailChange: (detail: string) => void;
  /** Mode-specific options or warnings between the field and the buttons. */
  children?: ReactNode;
  error?: string | null;
  busy: boolean;
  submitLabel: string;
  busyLabel?: string;
  destructive?: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      {/* 입력하려고 연 팝업이라 입력칸에 바로 포커스를 준다. `autoFocus`는 Base UI 초기 포커스에 덮인다. */}
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!busy}
        initialFocus={fieldRef}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {dateFormat.format(calendarDate(date))}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && detail.trim()) onSubmit();
          }}
        >
          <TextField
            ref={fieldRef}
            aria-label={fieldLabel}
            placeholder={fieldLabel}
            autoComplete="off"
            maxLength={200}
            value={detail}
            disabled={busy}
            onChange={(event) => onDetailChange(event.target.value)}
          />
          {children}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              취소
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={busy || !detail.trim()}
            >
              {busy ? <Spinner data-icon="inline-start" /> : null}
              {busy && busyLabel ? busyLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 공강 신청과 선예약 팝업의 매주 반복 옵션. 노래방은 일회성이라 쓰지 않는다. */
export function RecurringCheckbox({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      매주 반복
    </label>
  );
}

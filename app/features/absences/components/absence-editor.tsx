import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import {
  deleteMyAbsence,
  setMyAbsence,
} from "~/features/absences/data/mutations";
import {
  ABSENCE_REASON_MAX_LENGTH,
  isAbsenceReasonValid,
  normalizeAbsenceReason,
} from "~/features/absences/model/absence";
import { Button } from "~/shared/ui/button";
import { Textarea } from "~/shared/ui/textarea";

export function AbsenceEditor({
  initialReason,
  onSaved,
}: {
  initialReason: string | null;
  onSaved?: () => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const [reason, setReason] = useState(initialReason ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedReason = normalizeAbsenceReason(reason);
  const valid = isAbsenceReasonValid(reason);
  const editing = initialReason !== null;

  async function finish() {
    if (onSaved) {
      await onSaved();
    } else {
      await navigate("/");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!valid || pending) return;

    setPending(true);
    setError(null);

    try {
      await setMyAbsence(normalizedReason);
      await finish();
    } catch {
      setError("저장하지 못했습니다.");
      setPending(false);
    }
  }

  async function remove() {
    if (!editing || pending) return;

    if (!window.confirm("공결 · 병결 기록을 삭제할까요?")) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      await deleteMyAbsence();
      await finish();
    } catch {
      setError("삭제하지 못했습니다.");
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex items-end justify-between gap-4">
        <label htmlFor="absence-reason" className="text-sm font-medium">
          사유
        </label>

        <span className="text-xs text-muted-foreground">
          {normalizedReason.length}/{ABSENCE_REASON_MAX_LENGTH}
        </span>
      </div>

      <Textarea
        id="absence-reason"
        value={reason}
        onChange={(event) => setReason(event.currentTarget.value)}
        maxLength={ABSENCE_REASON_MAX_LENGTH}
        rows={4}
        placeholder="사유를 입력하세요"
        aria-invalid={Boolean(reason) && !valid}
        disabled={pending}
        className="[field-sizing:fixed] min-h-28 max-w-full min-w-0 resize-none"
      />

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        {editing ? (
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void remove()}
          >
            삭제
          </Button>
        ) : (
          <span />
        )}

        <Button type="submit" disabled={!valid || pending}>
          {pending ? "처리 중" : editing ? "수정" : "알리기"}
        </Button>
      </div>
    </form>
  );
}

import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { gongangCellLabel, parseGongangKey } from "../model/gongang-slots";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";
import { TextField } from "~/shared/ui/text-field";

interface Props {
  date: string;
  selected: string[];
  /** Per-cell consequence shown on its chip, such as a repeat that will end. */
  warnings?: ReadonlyMap<string, string>;
  notice?: ReactNode;
  detail: string;
  recurring: boolean;
  busy: boolean;
  submitLabel: string;
  onRemove: (key: string) => void;
  onClear: () => void;
  onDetailChange: (detail: string) => void;
  onRecurringChange: (recurring: boolean) => void;
  onSubmit: () => void;
}

/**
 * The sticky panel under a gongang board. Every selected cell is a chip the
 * user can drop without hunting for it on the board, which matters on weekends
 * where the selection spans floors that are not on screen.
 */
export function GongangSelectionForm({
  date,
  selected,
  warnings,
  notice,
  detail,
  recurring,
  busy,
  submitLabel,
  onRemove,
  onClear,
  onDetailChange,
  onRecurringChange,
  onSubmit,
}: Props) {
  return (
    <form
      aria-label="선택한 칸"
      className="sticky bottom-0 z-10 space-y-3 rounded-xl border bg-background p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium" aria-live="polite">
          {selected.length}칸 선택
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onClear}
        >
          모두 해제
        </Button>
      </div>
      <ul className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
        {selected.map((key) => {
          const { slot, location } = parseGongangKey(key);
          const label = gongangCellLabel(date, slot, location);
          const warning = warnings?.get(key);
          return (
            <li key={key}>
              <button
                type="button"
                disabled={busy}
                aria-label={`${label} 선택 해제`}
                onClick={() => onRemove(key)}
                className={cn(
                  "inline-flex min-h-8 touch-manipulation items-center gap-1 rounded-full px-2.5 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  warning
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-foreground",
                )}
              >
                <span>{label}</span>
                {warning && <span>· {warning}</span>}
                <XIcon aria-hidden className="size-3" />
              </button>
            </li>
          );
        })}
      </ul>
      {notice}
      <TextField
        aria-label="사용 목적"
        placeholder="사용 목적"
        name="purpose"
        autoComplete="off"
        maxLength={200}
        value={detail}
        disabled={busy}
        onChange={(event) => onDetailChange(event.target.value)}
      />
      <div className="flex items-center justify-between gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={recurring}
            disabled={busy}
            onChange={(event) => onRecurringChange(event.target.checked)}
          />
          매주 반복
        </label>
        <Button type="submit" disabled={busy || !detail.trim()}>
          {busy && <Spinner />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function GongangLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-2 text-sm text-destructive"
    >
      <p>{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  );
}

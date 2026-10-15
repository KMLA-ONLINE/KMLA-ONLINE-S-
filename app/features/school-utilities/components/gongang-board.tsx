import { CheckIcon, PlusIcon, Repeat2Icon } from "lucide-react";
import {
  GONGANG_FLOORS,
  gongangKey,
  gongangSlots,
  isGongangWeekend,
} from "../model/gongang-slots";
import { cn } from "~/shared/lib/utils";

import type { GongangBoardEntry } from "../model/gongang-entries";
export type { GongangBoardEntry } from "../model/gongang-entries";

interface Props {
  date: string;
  /** Weekend boards show one floor at a time. The screen owns it so a date change keeps it. */
  floorId: string;
  onFloorChange: (floorId: string) => void;
  selected: string[];
  entries: GongangBoardEntry[];
  onSelect: (slot: string, location: string) => void;
  onInspect?: (entry: GongangBoardEntry) => void;
  disabled?: boolean;
  readOnly?: boolean;
  allowPreempt?: boolean;
}
export function GongangBoard({
  date,
  floorId,
  onFloorChange,
  selected,
  entries,
  onSelect,
  onInspect,
  disabled = false,
  readOnly = false,
  allowPreempt = false,
}: Props) {
  const slots = gongangSlots(date);
  const byKey = new Map(
    entries.map((entry) => [gongangKey(entry.slot, entry.location), entry]),
  );
  const weekend = isGongangWeekend(date);

  function cell(
    slot: { id: string; label: string },
    floor: (typeof GONGANG_FLOORS)[number],
  ) {
    const entry = byKey.get(gongangKey(slot.id, floor.id));
    const selectable = !entry || (allowPreempt && entry.state !== "manager");
    const checked = selected.includes(gongangKey(slot.id, floor.id));
    return (
      <button
        type="button"
        disabled={disabled || (readOnly && !entry)}
        aria-label={`${slot.label} ${floor.label}${entry ? ` ${entry.label}` : ""}${selectable ? " 선택" : ""}`}
        aria-pressed={selectable ? checked : undefined}
        onClick={() =>
          selectable ? onSelect(slot.id, floor.id) : entry && onInspect?.(entry)
        }
        className={cn(
          "flex min-h-14 w-full touch-manipulation flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 sm:text-sm",
          checked
            ? "bg-primary text-primary-foreground"
            : entry?.state === "mine"
              ? "bg-primary/10 text-primary"
              : entry
                ? "bg-muted text-muted-foreground"
                : "bg-muted/30 hover:bg-primary/10",
        )}
      >
        {weekend && (
          <span className="font-medium tabular-nums">{slot.label}</span>
        )}
        {entry ? (
          <span className="flex w-full min-w-0 flex-col items-center gap-1">
            <span className="flex max-w-full items-center gap-1">
              <span className="truncate">{entry.label}</span>
              {checked && <CheckIcon aria-hidden className="size-3 shrink-0" />}
              {entry.recurring && (
                <Repeat2Icon
                  aria-label="매주 반복"
                  className="size-3 shrink-0"
                />
              )}
            </span>
            {entry.detail && (
              <span
                className={cn(
                  "line-clamp-2 w-full text-[10px] leading-snug break-words sm:text-xs",
                  checked
                    ? "text-primary-foreground/80"
                    : "text-muted-foreground",
                )}
              >
                {entry.detail}
              </span>
            )}
          </span>
        ) : checked ? (
          <CheckIcon aria-hidden className="size-4" />
        ) : readOnly ? (
          <span aria-hidden>—</span>
        ) : (
          <PlusIcon aria-hidden className="size-4 text-muted-foreground" />
        )}
      </button>
    );
  }

  if (weekend) {
    const floor =
      GONGANG_FLOORS.find((item) => item.id === floorId) ?? GONGANG_FLOORS[0];
    return (
      <section aria-label="주말 공강 예약" className="space-y-3">
        <div
          role="group"
          aria-label="층 선택"
          className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1"
        >
          {GONGANG_FLOORS.map((item) => {
            const count = selected.filter((key) =>
              key.endsWith(`:${item.id}`),
            ).length;
            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                aria-pressed={floorId === item.id}
                onClick={() => onFloorChange(item.id)}
                className={cn(
                  "min-h-11 touch-manipulation rounded-lg px-1 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  floorId === item.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
                {count > 0 && (
                  <span
                    aria-hidden
                    className="ml-1 inline-flex size-4 items-center justify-center rounded-full bg-primary/10 text-[10px] text-primary"
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {slots.map((slot) => (
            <div key={slot.id}>{cell(slot, floor)}</div>
          ))}
        </div>
      </section>
    );
  }
  return (
    <table
      aria-label="공강 예약"
      className="w-full table-fixed border-separate border-spacing-1 text-sm"
    >
      <thead>
        <tr>
          <th
            scope="col"
            className="w-14 py-2 text-xs font-normal text-muted-foreground"
          >
            시간
          </th>
          {GONGANG_FLOORS.map((floor) => (
            <th
              key={floor.id}
              scope="col"
              className="py-2 text-xs font-medium sm:text-sm"
            >
              {floor.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {slots.map((slot) => (
          <tr key={slot.id}>
            <th scope="row" className="text-xs font-medium sm:text-sm">
              {slot.label}
            </th>
            {GONGANG_FLOORS.map((floor) => (
              <td key={floor.id} className="p-0">
                {cell(slot, floor)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

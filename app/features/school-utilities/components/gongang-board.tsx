import { CheckIcon, PlusIcon, Repeat2Icon } from "lucide-react";
import {
  GONGANG_FLOORS,
  gongangKey,
  gongangSlots,
  type GongangSlot,
} from "../model/gongang-slots";
import { cn } from "~/shared/lib/utils";

import type { GongangBoardEntry } from "../model/gongang-entries";
export type { GongangBoardEntry } from "../model/gongang-entries";

// Weekend boards run to 14 rows, so the floor names stay in view while scrolling.
// Mobile scrolls under the page header; desktop scrolls inside the shell below its header.
const stickyHeader =
  "sticky top-[calc(var(--app-page-header-h)+var(--app-safe-t))] z-[1] border-b bg-background md:top-0";

// No outer frame, like the karaoke and birthday lists: rows close with a bottom line
// and only the inner columns are divided.
const gridCell = "border-r border-b last:border-r-0";

interface Props {
  date: string;
  selected: string[];
  entries: GongangBoardEntry[];
  onSelect: (slot: string, location: string) => void;
  onInspect?: (entry: GongangBoardEntry) => void;
  disabled?: boolean;
  readOnly?: boolean;
}
export function GongangBoard({
  date,
  selected,
  entries,
  onSelect,
  onInspect,
  disabled = false,
  readOnly = false,
}: Props) {
  const slots = gongangSlots(date);
  const byKey = new Map(
    entries.map((entry) => [gongangKey(entry.slot, entry.location), entry]),
  );

  function cell(slot: GongangSlot, floor: (typeof GONGANG_FLOORS)[number]) {
    const entry = byKey.get(gongangKey(slot.id, floor.id));
    const checked = selected.includes(gongangKey(slot.id, floor.id));
    // An occupied cell opens its details first; the screen decides whether it can be selected.
    // Once selected, tapping it again simply drops it.
    const selectable = !entry || checked;
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
          "flex h-full min-h-14 w-full touch-manipulation flex-col items-center justify-center gap-1 px-1 py-2 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset disabled:opacity-50 sm:text-sm",
          checked
            ? "bg-action text-action-foreground"
            : entry?.state === "mine"
              ? "bg-primary/10 text-primary"
              : entry
                ? "bg-muted/40 text-muted-foreground"
                : "enabled:hover:bg-muted/35",
        )}
      >
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
                    ? "text-action-foreground/80"
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
          <PlusIcon aria-hidden className="size-4 text-muted-foreground/50" />
        )}
      </button>
    );
  }

  return (
    <table
      aria-label="공강 예약"
      // Separate borders stay on sticky header cells; collapsed ones scroll away.
      className="w-full table-fixed border-separate border-spacing-0 text-sm"
    >
      <thead>
        <tr>
          <th
            scope="col"
            className={cn(
              "w-14 py-2 text-xs font-normal text-muted-foreground",
              gridCell,
              stickyHeader,
            )}
          >
            시간
          </th>
          {GONGANG_FLOORS.map((floor) => (
            <th
              key={floor.id}
              scope="col"
              className={cn(
                "py-2 text-xs font-medium sm:text-sm",
                gridCell,
                stickyHeader,
              )}
            >
              {floor.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {slots.map((slot) => (
          <tr key={slot.id}>
            <th
              scope="row"
              className={cn(
                "bg-muted/15 text-xs font-medium tabular-nums sm:text-sm",
                gridCell,
              )}
            >
              {slot.short ?? slot.label}
            </th>
            {GONGANG_FLOORS.map((floor) => (
              // The fixed height lets each button fill its cell when a neighbour wraps taller.
              <td key={floor.id} className={cn("h-14 p-0", gridCell)}>
                {cell(slot, floor)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

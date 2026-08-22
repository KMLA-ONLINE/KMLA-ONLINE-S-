import { PlusIcon, Repeat2Icon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { useAppShell } from "~/features/app-shell";
import {
  createUtilityReservation,
  deleteUtilityReservation,
  loadUtilityReservations,
  type UtilityReservation as DbReservation,
} from "~/features/school-utilities/data/reservations";
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Checkbox } from "~/shared/ui/checkbox";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";
import { Spinner } from "~/shared/ui/spinner";

export type UtilityMode = "gongang" | "karaoke";

interface UtilityBookingScreenProps {
  mode: UtilityMode;
}

interface Slot {
  id: string;
  label: string;
}

interface Reservation {
  id: number;
  applicantName: string;
  applicantCohort: number | null;
  avatarUrl: string | null;
  detail: string;
  recurring: boolean;
}

interface Draft {
  detail: string;
  recurring: boolean;
}

const MODES = [
  { id: "gongang", label: "공강", to: "/util/gongang" },
  { id: "karaoke", label: "노래방", to: "/util/karaoke" },
] as const;

const FLOORS = [
  { id: "floor_b1", label: "지하 1층" },
  { id: "floor_2", label: "2층" },
  { id: "floor_4", label: "4층" },
  { id: "floor_10", label: "10층" },
] as const;

const GONGANG_SLOTS: Slot[] = [
  { id: "study-1", label: "1자습" },
  { id: "honjeong-end", label: "혼정끝" },
  { id: "study-2", label: "2자습" },
];

const WEEKDAY_KARAOKE_SLOTS: Slot[] = [
  { id: "lunch", label: "점심" },
  { id: "dinner", label: "저녁" },
];

const WEEKEND_KARAOKE_SLOTS: Slot[] = Array.from(
  { length: 11 },
  (_, position) => {
    const start = position + 8;

    return {
      id: `hour-${start}`,
      label: `${String(start).padStart(2, "0")}:00–${String(start + 1).padStart(
        2,
        "0",
      )}:00`,
    };
  },
);

const WEEKEND_GONGANG_SLOTS: Slot[] = [
  ...WEEKEND_KARAOKE_SLOTS,
  ...GONGANG_SLOTS,
];

/** 편집기는 한 번에 하나만 열리므로 이 id를 독점한다. */
const RECURRING_FIELD_ID = "utility-recurring";

const rangeDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
});

const weekdayFormatter = new Intl.DateTimeFormat("ko-KR", {
  weekday: "short",
});

const fullDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  weekday: "long",
});

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return startOfDay(next);
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

function getWeekDates(date: Date) {
  return Array.from({ length: 7 }, (_, position) => addDays(date, position));
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function initialDay() {
  const day = new Date().getDay();
  return day === 0 ? 6 : day - 1;
}

function isWeekend(date: Date) {
  return date.getDay() === 0 || date.getDay() === 6;
}

function reservationKey(
  mode: UtilityMode,
  date: Date,
  slot: string,
  location?: string,
) {
  return [mode, dateKey(date), slot, location].filter(Boolean).join(":");
}

function recurringKey(
  mode: UtilityMode,
  date: Date,
  slot: string,
  location?: string,
) {
  return [mode, date.getDay(), slot, location].filter(Boolean).join(":");
}

function emptyDraft(): Draft {
  return {
    detail: "",
    recurring: false,
  };
}

function reservationFromDb(row: DbReservation): Reservation {
  return {
    id: row.id,
    applicantName: row.applicantName,
    applicantCohort: row.applicantCohort,
    avatarUrl: row.avatarUrl,
    detail: row.detail,
    recurring: row.recurring,
  };
}

function buildReservationMaps(rows: DbReservation[]) {
  const direct: Record<string, Reservation> = {};
  const recurring: Record<string, Reservation> = {};

  for (const row of rows) {
    const date = new Date(`${row.reservationDate}T12:00:00`);
    const reservation = reservationFromDb(row);

    if (row.recurring) {
      recurring[
        recurringKey(row.mode, date, row.slot, row.location ?? undefined)
      ] = reservation;
    } else {
      direct[
        reservationKey(row.mode, date, row.slot, row.location ?? undefined)
      ] = reservation;
    }
  }

  return { direct, recurring };
}

function ModeTabs({ mode }: { mode: UtilityMode }) {
  return (
    <nav aria-label="공강 및 노래방" className="flex border-b">
      {MODES.map((item) => {
        const active = item.id === mode;

        return (
          <Link
            key={item.id}
            to={item.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 flex-1 items-center justify-center border-b-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

interface WeekStripProps {
  dates: Date[];
  selectedDay: number;
  onSelect: (position: number, date: Date) => void;
}

function WeekStrip({ dates, selectedDay, onSelect }: WeekStripProps) {
  const today = dateKey(new Date());

  return (
    <div className="grid grid-cols-7">
      {dates.map((date, position) => {
        const selected = position === selectedDay;

        return (
          <button
            key={dateKey(date)}
            type="button"
            aria-label={fullDateFormatter.format(date)}
            aria-pressed={selected}
            onClick={() => onSelect(position, date)}
            className="flex touch-manipulation flex-col items-center gap-1 rounded-xl py-1.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span
              className={cn(
                "text-xs transition-colors",
                selected ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {weekdayFormatter.format(date).replace(".", "")}
            </span>

            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-full text-sm font-semibold tabular-nums transition-colors",
                selected && "bg-primary text-primary-foreground",
                !selected && dateKey(date) === today && "text-primary",
              )}
            >
              {date.getDate()}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface SlotTabsProps {
  slots: Slot[];
  activeSlot: string;
  onSelect: (slot: string) => void;
}

/** 평일은 3개, 주말은 14개다. 모바일은 가로 스크롤, 데스크톱은 줄바꿈으로 전부 보여준다. */
function SlotTabs({ slots, activeSlot, onSelect }: SlotTabsProps) {
  return (
    <div
      role="group"
      aria-label="시간"
      className="-mx-4 no-scrollbar flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
    >
      {slots.map((slot) => {
        const active = slot.id === activeSlot;

        return (
          <button
            key={slot.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(slot.id)}
            className={cn(
              "inline-flex h-9 shrink-0 touch-manipulation items-center rounded-full border px-3.5 text-sm font-medium whitespace-nowrap tabular-nums transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-transparent text-muted-foreground hover:bg-muted",
            )}
          >
            {slot.label}
          </button>
        );
      })}
    </div>
  );
}

interface ReservationEditorProps {
  mode: UtilityMode;
  label: string;
  labelClassName: string;
  draft: Draft;
  onChange: (draft: Draft) => void;
  onClose: () => void;
  onSave: () => void;
}

/** 열린 줄이 그대로 입력 폼이 된다. 줄을 눌러서 연 입력이므로 커서를 바로 넣어 준다. */
function ReservationEditor({
  mode,
  label,
  labelClassName,
  draft,
  onChange,
  onClose,
  onSave,
}: ReservationEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form
      className="px-1 py-2.5 md:px-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="flex items-center gap-3">
        <span className={cn("shrink-0 text-sm font-semibold", labelClassName)}>
          {label}
        </span>

        <Input
          ref={inputRef}
          value={draft.detail}
          aria-label={mode === "gongang" ? "목적" : "사용자 명단"}
          placeholder={mode === "gongang" ? "목적" : "사용자 명단"}
          onChange={(event) =>
            onChange({
              ...draft,
              detail: event.target.value,
            })
          }
        />
      </div>

      <div className="mt-2 flex items-center justify-end gap-2">
        {mode === "gongang" ? (
          <div className="mr-auto flex items-center gap-2">
            <Checkbox
              id={RECURRING_FIELD_ID}
              checked={draft.recurring}
              onCheckedChange={(checked) =>
                onChange({
                  ...draft,
                  recurring: checked === true,
                })
              }
            />

            <Label
              htmlFor={RECURRING_FIELD_ID}
              className="font-normal text-muted-foreground"
            >
              장기
            </Label>
          </div>
        ) : null}

        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          취소
        </Button>

        <Button type="submit" size="sm" disabled={!draft.detail.trim()}>
          신청
        </Button>
      </div>
    </form>
  );
}

interface BookingRowProps {
  mode: UtilityMode;
  label: string;
  labelClassName: string;
  reservation?: Reservation;
  draft: Draft;
  open: boolean;
  onOpen: () => void;
  onDraftChange: (draft: Draft) => void;
  onClose: () => void;
  onSave: () => void;
  onCancel: () => void;
}

/**
 * 층(공강) 또는 시간(노래방) 한 줄.
 *
 * 비어 있으면 줄 전체가 신청 버튼이고, 열리면 같은 자리에서 바로 입력한다.
 * 카드 안에 카드를 겹치지 않는 게 이 화면의 규칙이다.
 */
function BookingRow({
  mode,
  label,
  labelClassName,
  reservation,
  draft,
  open,
  onOpen,
  onDraftChange,
  onClose,
  onSave,
  onCancel,
}: BookingRowProps) {
  if (reservation) {
    return (
      <div className="flex min-h-14 items-center gap-3 px-1 py-2 md:px-4">
        <span className={cn("shrink-0 text-sm font-semibold", labelClassName)}>
          {label}
        </span>

        {/* `sm`(24px)은 두 줄짜리 줄에서 작아 보이고 `default`(32px)는 과하다.
            `default` 기준 클래스만 tailwind-merge로 덮어써서 28px로 쓴다. */}
        <UserAvatar
          src={reservation.avatarUrl}
          name={reservation.applicantName}
          className="size-8 shrink-0"
        />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-sm font-semibold">
              {reservation.applicantCohort === null ? null : (
                <span>{reservation.applicantCohort}기 </span>
              )}
              {reservation.applicantName}
            </p>

            {reservation.recurring ? (
              <Repeat2Icon
                className="size-3.5 shrink-0 text-primary"
                aria-label="매주"
              />
            ) : null}
          </div>

          <p className="truncate text-sm text-muted-foreground">
            {reservation.detail}
          </p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`${label} 예약 취소`}
          className="shrink-0 text-muted-foreground"
          onClick={onCancel}
        >
          <XIcon />
        </Button>
      </div>
    );
  }

  if (open) {
    return (
      <ReservationEditor
        mode={mode}
        label={label}
        labelClassName={labelClassName}
        draft={draft}
        onChange={onDraftChange}
        onClose={onClose}
        onSave={onSave}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex min-h-14 w-full touch-manipulation items-center gap-3 px-1 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none md:px-4"
    >
      <span className={cn("shrink-0 text-sm font-semibold", labelClassName)}>
        {label}
      </span>

      <span className="flex-1" />

      <span className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors group-hover:text-primary">
        <PlusIcon className="size-4" aria-hidden />
        신청
      </span>
    </button>
  );
}

export function UtilityBookingScreen({ mode }: UtilityBookingScreenProps) {
  const { profile } = useAppShell();
  const [weekStart] = useState(() => startOfWeek(new Date()));
  const [selectedDay, setSelectedDay] = useState(initialDay);
  const [selectedSlot, setSelectedSlot] = useState(() =>
    isWeekend(new Date())
      ? (WEEKEND_GONGANG_SLOTS[0]?.id ?? "")
      : (GONGANG_SLOTS[0]?.id ?? ""),
  );

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  // 주는 고정이고 mode는 route가 바뀌며 다시 mount되므로, 로딩은 mount 직후 한 번뿐이다.
  const [loading, setLoading] = useState(true);
  const [reservations, setReservations] = useState<Record<string, Reservation>>(
    {},
  );
  const [recurringReservations, setRecurringReservations] = useState<
    Record<string, Reservation>
  >({});

  const dates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const selectedDate = dates[selectedDay] ?? weekStart;
  const weekEnd = dates[6] ?? weekStart;

  useEffect(() => {
    let cancelled = false;

    void loadUtilityReservations(mode, dateKey(weekStart), dateKey(weekEnd))
      .then((rows) => {
        if (cancelled) return;

        const maps = buildReservationMaps(rows);
        setReservations(maps.direct);
        setRecurringReservations(maps.recurring);
      })
      .catch((error: unknown) => {
        console.error("Failed to load utility reservations", error);
      })
      .finally(() => {
        if (cancelled) return;

        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, weekStart, weekEnd]);

  const weekend = isWeekend(selectedDate);

  const karaokeSlots = weekend ? WEEKEND_KARAOKE_SLOTS : WEEKDAY_KARAOKE_SLOTS;

  const gongangSlots = weekend ? WEEKEND_GONGANG_SLOTS : GONGANG_SLOTS;

  const activeGongangSlot = gongangSlots.some(
    (slot) => slot.id === selectedSlot,
  )
    ? selectedSlot
    : (gongangSlots[0]?.id ?? "");

  const updateDraft = (key: string, draft: Draft) => {
    setDrafts((current) => ({
      ...current,
      [key]: draft,
    }));
  };

  const saveReservation = async (
    key: string,
    repeatKey: string,
    draft: Draft,
  ) => {
    const detail = draft.detail.trim();
    if (!detail) return;

    const parts = key.split(":");
    const reservationDate = parts[1];
    const slot = parts[2];
    const location = parts[3] ?? null;

    if (!reservationDate || !slot) return;

    try {
      const created = await createUtilityReservation({
        profileId: profile.id,
        mode,
        reservationDate,
        slot,
        location: mode === "gongang" ? location : null,
        detail,
        recurring: mode === "gongang" && draft.recurring,
      });

      const reservation = reservationFromDb(created);

      if (created.recurring) {
        setRecurringReservations((current) => ({
          ...current,
          [repeatKey]: reservation,
        }));

        setReservations((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      } else {
        setReservations((current) => ({
          ...current,
          [key]: reservation,
        }));
      }

      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });

      setOpenKey(null);
    } catch (error) {
      console.error("Failed to create utility reservation", error);
    }
  };

  const cancelReservation = async (
    key: string,
    repeatKey: string,
    recurring: boolean,
  ) => {
    const reservation = recurring
      ? recurringReservations[repeatKey]
      : reservations[key];

    if (!reservation) return;

    try {
      await deleteUtilityReservation(reservation.id);

      if (recurring) {
        setRecurringReservations((current) => {
          const next = { ...current };
          delete next[repeatKey];
          return next;
        });
      } else {
        setReservations((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }

      setOpenKey(null);
    } catch (error) {
      console.error("Failed to delete utility reservation", error);
    }
  };

  const selectDate = (position: number, date: Date) => {
    setSelectedDay(position);

    setSelectedSlot(
      isWeekend(date)
        ? (WEEKEND_GONGANG_SLOTS[0]?.id ?? "")
        : (GONGANG_SLOTS[0]?.id ?? ""),
    );

    setOpenKey(null);
  };

  const rows =
    mode === "gongang"
      ? FLOORS.map((floor) => {
          const key = reservationKey(
            "gongang",
            selectedDate,
            activeGongangSlot,
            floor.id,
          );

          const repeatKey = recurringKey(
            "gongang",
            selectedDate,
            activeGongangSlot,
            floor.id,
          );

          return {
            key,
            repeatKey,
            label: floor.label,
            reservation: reservations[key] ?? recurringReservations[repeatKey],
          };
        })
      : karaokeSlots.map((slot) => {
          const key = reservationKey("karaoke", selectedDate, slot.id);

          return {
            key,
            repeatKey: "",
            label: slot.label,
            reservation: reservations[key],
          };
        });

  // 주말 노래방 라벨만 "08:00–09:00"처럼 길다. 나머지는 좁게 잡아야 이름과 목적이 덜 잘린다.
  const labelClassName =
    mode === "karaoke" && weekend ? "w-28 tabular-nums" : "w-16";

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-10 md:px-0">
      <h1 className="mb-4 hidden text-2xl font-semibold md:block">
        공강 · 노래방
      </h1>

      <ModeTabs mode={mode} />

      <p className="mt-4 px-1 text-xs font-medium text-muted-foreground tabular-nums">
        {rangeDateFormatter.format(weekStart)} –{" "}
        {rangeDateFormatter.format(weekEnd)}
      </p>

      <div className="mt-1">
        <WeekStrip
          dates={dates}
          selectedDay={selectedDay}
          onSelect={selectDate}
        />
      </div>

      {mode === "gongang" ? (
        <div className="mt-3">
          <SlotTabs
            slots={gongangSlots}
            activeSlot={activeGongangSlot}
            onSelect={(slot) => {
              setSelectedSlot(slot);
              setOpenKey(null);
            }}
          />
        </div>
      ) : null}

      <div className="mt-3 md:mt-4">
        {loading ? (
          <div className="flex justify-center py-16" aria-live="polite">
            <Spinner aria-label="예약 불러오는 중" />
          </div>
        ) : (
          <div className="divide-y overflow-hidden md:rounded-2xl md:border md:bg-card">
            {rows.map((row) => (
              <BookingRow
                key={row.key}
                mode={mode}
                label={row.label}
                labelClassName={labelClassName}
                reservation={row.reservation}
                draft={drafts[row.key] ?? emptyDraft()}
                open={openKey === row.key}
                onOpen={() => setOpenKey(row.key)}
                onDraftChange={(draft) => updateDraft(row.key, draft)}
                onClose={() => setOpenKey(null)}
                onSave={() => {
                  void saveReservation(
                    row.key,
                    row.repeatKey,
                    drafts[row.key] ?? emptyDraft(),
                  );
                }}
                onCancel={() => {
                  void cancelReservation(
                    row.key,
                    row.repeatKey,
                    row.reservation?.recurring ?? false,
                  );
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

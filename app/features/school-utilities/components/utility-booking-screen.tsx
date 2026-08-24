import { PlusIcon, Repeat2Icon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { useAppShell } from "~/features/app-shell";
import {
  canManageGongang,
  loadGongangSchedule,
} from "~/features/school-utilities/data/gongang-schedule";
import {
  createUtilityReservation,
  deleteUtilityReservation,
  loadUtilityReservations,
  type UtilityReservation as DbReservation,
} from "~/features/school-utilities/data/reservations";
import {
  addCalendarDays,
  calendarDate,
  calendarWeekday,
  startOfKoreaWeek,
  useKoreaToday,
} from "~/features/school-utilities/model/korea-date";
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
  profileId: number;
  reservationDate: string;
  applicantName: string;
  applicantPubId: string;
  applicantCohort: number | null;
  avatarUrl: string | null;
  detail: string;
  recurring: boolean;
  recurringUntil: string | null;
}

interface Draft {
  detail: string;
  recurring: boolean;
}

interface ManagerReservation {
  detail: string;
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
  timeZone: "UTC",
  month: "numeric",
  day: "numeric",
});

const weekdayFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "UTC",
  weekday: "short",
});

const fullDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  weekday: "long",
});

function getWeekDates(date: string) {
  return Array.from({ length: 7 }, (_, position) =>
    addCalendarDays(date, position),
  );
}

function initialDay(today: string) {
  const day = calendarWeekday(today);
  return day === 0 ? 6 : day - 1;
}

function isWeekend(date: string) {
  const day = calendarWeekday(date);
  return day === 0 || day === 6;
}

function reservationKey(
  mode: UtilityMode,
  date: string,
  slot: string,
  location?: string,
) {
  return [mode, date, slot, location].filter(Boolean).join(":");
}

function recurringKey(
  mode: UtilityMode,
  date: string,
  slot: string,
  location?: string,
) {
  return [mode, calendarWeekday(date), slot, location]
    .filter(Boolean)
    .join(":");
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
    profileId: row.profileId,
    reservationDate: row.reservationDate,
    applicantName: row.applicantName,
    applicantPubId: row.applicantPubId,
    applicantCohort: row.applicantCohort,
    avatarUrl: row.avatarUrl,
    detail: row.detail,
    recurring: row.recurring,
    recurringUntil: row.recurringUntil,
  };
}

function buildReservationMaps(rows: DbReservation[]) {
  const direct: Record<string, Reservation> = {};
  const recurring: Record<string, Reservation> = {};

  for (const row of rows) {
    const date = row.reservationDate;
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
  dates: string[];
  selectedDay: number;
  onSelect: (position: number, date: string) => void;
  today: string;
}

function WeekStrip({ dates, selectedDay, onSelect, today }: WeekStripProps) {
  return (
    <div className="grid grid-cols-7">
      {dates.map((date, position) => {
        const selected = position === selectedDay;

        return (
          <button
            key={date}
            type="button"
            aria-label={fullDateFormatter.format(calendarDate(date))}
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
              {weekdayFormatter.format(calendarDate(date)).replace(".", "")}
            </span>

            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-full text-sm font-semibold tabular-nums transition-colors",
                selected && "bg-primary text-primary-foreground",
                !selected && date === today && "text-primary",
              )}
            >
              {calendarDate(date).getUTCDate()}
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
  saving: boolean;
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
  saving,
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
          maxLength={200}
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

        <Button
          type="submit"
          size="sm"
          disabled={saving || !draft.detail.trim()}
        >
          {saving ? "신청 중..." : "신청"}
        </Button>
      </div>
    </form>
  );
}

interface BookingRowProps {
  mode: UtilityMode;
  label: string;
  labelClassName: string;
  managerReservation?: ManagerReservation;
  reservation?: Reservation;
  draft: Draft;
  open: boolean;
  onOpen: () => void;
  onDraftChange: (draft: Draft) => void;
  onClose: () => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  canCancel: boolean;
  canBook: boolean;
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
  managerReservation,
  reservation,
  draft,
  open,
  onOpen,
  onDraftChange,
  onClose,
  onSave,
  onCancel,
  saving,
  canCancel,
  canBook,
}: BookingRowProps) {
  if (managerReservation) {
    return (
      <div className="flex min-h-14 items-center gap-3 px-1 py-2 md:px-4">
        <span className={cn("shrink-0 text-sm font-semibold", labelClassName)}>
          {label}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">공강 관리자 선예약</p>
          <p className="truncate text-sm text-muted-foreground">
            {managerReservation.detail}
          </p>
        </div>

        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          사용 불가
        </span>
      </div>
    );
  }

  if (reservation) {
    return (
      <div className="flex min-h-14 items-center gap-3 px-1 py-2 md:px-4">
        <span className={cn("shrink-0 text-sm font-semibold", labelClassName)}>
          {label}
        </span>

        {/* `sm`(24px)은 두 줄짜리 줄에서 작아 보이고 `default`(32px)는 과하다.
            `default` 기준 클래스만 tailwind-merge로 덮어써서 28px로 쓴다. */}
        <Link
          to={`/profile/${reservation.applicantPubId}`}
          aria-label={`${reservation.applicantName} 프로필`}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
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
        </Link>

        {canCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`${label} 예약 취소`}
            className="shrink-0 text-muted-foreground"
            disabled={saving}
            onClick={onCancel}
          >
            <XIcon />
          </Button>
        ) : null}
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
        saving={saving}
      />
    );
  }

  if (!canBook) {
    return (
      <div className="flex min-h-14 items-center gap-3 px-1 py-2 md:px-4">
        <span className={cn("shrink-0 text-sm font-semibold", labelClassName)}>
          {label}
        </span>
        <span className="ml-auto text-sm text-muted-foreground">신청 마감</span>
      </div>
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
  const today = useKoreaToday();
  const weekStart = useMemo(() => startOfKoreaWeek(today), [today]);
  const [selection, setSelection] = useState(() => ({
    weekStart,
    day: initialDay(today),
  }));
  const selectedDay =
    selection.weekStart === weekStart ? selection.day : initialDay(today);
  const setSelectedDay = (day: number) => setSelection({ weekStart, day });
  const [selectedSlot, setSelectedSlot] = useState(() =>
    isWeekend(today)
      ? (WEEKEND_GONGANG_SLOTS[0]?.id ?? "")
      : (GONGANG_SLOTS[0]?.id ?? ""),
  );

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  // 주는 고정이고 mode는 route가 바뀌며 다시 mount되므로, 로딩은 mount 직후 한 번뿐이다.
  const [loadedRange, setLoadedRange] = useState<string | null>(null);
  const [reservations, setReservations] = useState<Record<string, Reservation>>(
    {},
  );
  const [recurringReservations, setRecurringReservations] = useState<
    Record<string, Reservation>
  >({});
  const [managerReservations, setManagerReservations] = useState<
    Record<string, ManagerReservation>
  >({});
  const [canManage, setCanManage] = useState(false);
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  const dates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const selectedDate = dates[selectedDay] ?? weekStart;
  const weekEnd = dates[6] ?? weekStart;
  const loading = loadedRange !== `${mode}:${weekStart}`;

  useEffect(() => {
    const refresh = () => setRefreshVersion((current) => current + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => {
    if (mode !== "gongang") {
      return;
    }

    let cancelled = false;

    void canManageGongang(profile.id)
      .then((allowed) => {
        if (!cancelled) {
          setCanManage(allowed);
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to check gongang manager permission", error);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, profile.id]);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      loadUtilityReservations(mode, weekStart, weekEnd),
      mode === "gongang"
        ? loadGongangSchedule(weekStart, weekEnd)
        : Promise.resolve([]),
    ])
      .then(([rows, scheduleEntries]) => {
        if (cancelled) return;

        const maps = buildReservationMaps(rows);
        setReservations(maps.direct);
        setRecurringReservations(maps.recurring);

        const managerMap: Record<string, ManagerReservation> = {};

        for (const entry of scheduleEntries) {
          if (!entry.reserved) continue;

          managerMap[
            reservationKey(
              "gongang",
              entry.scheduleDate,
              entry.slot,
              entry.location,
            )
          ] = {
            detail: entry.detail ?? "공강 관리자 선예약",
          };
        }

        setManagerReservations(managerMap);
      })
      .catch((error: unknown) => {
        console.error("Failed to load utility reservations", error);
      })
      .finally(() => {
        if (cancelled) return;

        setLoadedRange(`${mode}:${weekStart}`);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, weekStart, weekEnd, refreshVersion]);

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
    if (!detail || mutationKey) return;

    const parts = key.split(":");
    const reservationDate = parts[1];
    const slot = parts[2];
    const location = parts[3] ?? null;

    if (!reservationDate || !slot) return;

    setMutationKey(key);
    setError(null);

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
      setError("다른 사용자가 먼저 신청했거나 신청할 수 없는 일정입니다.");
      setRefreshVersion((current) => current + 1);
    } finally {
      setMutationKey(null);
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

    if (!reservation || mutationKey) return;

    if (
      recurring &&
      !window.confirm(
        "이 날짜부터 장기 예약이 종료됩니다. 이전 예약 기록은 유지됩니다.",
      )
    ) {
      return;
    }

    setMutationKey(key);
    setError(null);

    try {
      await deleteUtilityReservation(
        reservation.id,
        recurring ? selectedDate : undefined,
      );

      if (recurring) {
        setRecurringReservations((current) => {
          const currentReservation = current[repeatKey];
          if (!currentReservation) return current;

          return {
            ...current,
            [repeatKey]: {
              ...currentReservation,
              recurringUntil: selectedDate,
            },
          };
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
      setError("예약을 취소할 수 없습니다. 새로고침 후 다시 시도해주세요.");
      setRefreshVersion((current) => current + 1);
    } finally {
      setMutationKey(null);
    }
  };

  const selectDate = (position: number, date: string) => {
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

          const recurringReservation = recurringReservations[repeatKey];
          const activeRecurringReservation =
            recurringReservation &&
            selectedDate >= recurringReservation.reservationDate &&
            (recurringReservation.recurringUntil === null ||
              selectedDate < recurringReservation.recurringUntil)
              ? recurringReservation
              : undefined;

          return {
            key,
            repeatKey,
            label: floor.label,
            managerReservation: managerReservations[key],
            reservation: reservations[key] ?? activeRecurringReservation,
          };
        })
      : karaokeSlots.map((slot) => {
          const key = reservationKey("karaoke", selectedDate, slot.id);

          return {
            key,
            repeatKey: "",
            label: slot.label,
            managerReservation: undefined,
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

      {mode === "gongang" && canManage ? (
        <div className="mt-3 flex justify-end px-1">
          <Link
            to="/util/gongang/manage"
            className="inline-flex min-h-9 items-center rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-muted"
          >
            다음 주 공강 선예약
          </Link>
        </div>
      ) : null}

      <p className="mt-4 px-1 text-xs font-medium text-muted-foreground tabular-nums">
        {rangeDateFormatter.format(calendarDate(weekStart))} –{" "}
        {rangeDateFormatter.format(calendarDate(weekEnd))}
      </p>

      <div className="mt-1">
        <WeekStrip
          dates={dates}
          selectedDay={selectedDay}
          onSelect={selectDate}
          today={today}
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
        {error ? (
          <p role="alert" className="mb-3 px-1 text-sm text-destructive">
            {error}
          </p>
        ) : null}

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
                managerReservation={row.managerReservation}
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
                saving={mutationKey === row.key}
                canCancel={
                  row.reservation?.profileId === profile.id &&
                  selectedDate >= today
                }
                canBook={selectedDate >= today}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { useAppShell } from "~/features/app-shell";
import {
  createUtilityReservation,
  deleteUtilityReservation,
  loadUtilityReservations,
  type UtilityMode,
  type UtilityReservation,
} from "../data/reservations";
import {
  addCalendarDays,
  calendarDate,
  calendarWeekday,
  startOfKoreaWeek,
  useKoreaToday,
} from "../model/korea-date";
import {
  reservationCancelErrorMessage,
  reservationCreateErrorMessage,
} from "../model/reservation-error";
import { GongangBookingScreen } from "./gongang-booking-screen";
import { UtilityManagers } from "./utility-managers";
import { UtilityModeTabs } from "./utility-mode-tabs";
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { TextField } from "~/shared/ui/text-field";
import { Spinner } from "~/shared/ui/spinner";

interface Slot {
  id: string;
  label: string;
}

const WEEKDAY_SLOTS: Slot[] = [
  { id: "lunch", label: "점심" },
  { id: "dinner", label: "저녁" },
];

const WEEKEND_SLOTS: Slot[] = Array.from({ length: 11 }, (_, position) => {
  const start = position + 8;

  return {
    id: `hour-${start}`,
    label: `${String(start).padStart(2, "0")}:00–${String(start + 1).padStart(
      2,
      "0",
    )}:00`,
  };
});

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

function reservationKey(date: string, slot: string) {
  return `${date}:${slot}`;
}

interface WeekStripProps {
  dates: string[];
  selectedDay: number;
  onSelect: (position: number) => void;
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
            onClick={() => onSelect(position)}
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
                selected && "bg-action text-action-foreground",
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

interface ReservationEditorProps {
  label: string;
  labelClassName: string;
  detail: string;
  onChange: (detail: string) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}

/** 열린 줄이 그대로 입력 폼이 된다. 줄을 눌러서 연 입력이므로 커서를 바로 넣어 준다. */
function ReservationEditor({
  label,
  labelClassName,
  detail,
  onChange,
  onClose,
  onSave,
  saving,
}: ReservationEditorProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

        <TextField
          ref={inputRef}
          value={detail}
          aria-label="이용자 명단"
          placeholder="이용자 명단"
          maxLength={200}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>

      <div className="mt-2 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          취소
        </Button>

        <Button type="submit" size="sm" disabled={saving || !detail.trim()}>
          {saving ? "예약 중…" : "예약"}
        </Button>
      </div>
    </form>
  );
}

interface BookingRowProps {
  label: string;
  labelClassName: string;
  reservation?: UtilityReservation;
  detail: string;
  open: boolean;
  onOpen: () => void;
  onDetailChange: (detail: string) => void;
  onClose: () => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  canCancel: boolean;
  canBook: boolean;
}

/**
 * 시간 한 줄.
 *
 * 비어 있으면 줄 전체가 예약 버튼이고, 열리면 같은 자리에서 바로 입력한다.
 * 카드 안에 카드를 겹치지 않는 게 이 화면의 규칙이다.
 */
function BookingRow({
  label,
  labelClassName,
  reservation,
  detail,
  open,
  onOpen,
  onDetailChange,
  onClose,
  onSave,
  onCancel,
  saving,
  canCancel,
  canBook,
}: BookingRowProps) {
  if (reservation) {
    return (
      <div className="flex min-h-14 items-center gap-3 px-1 py-2 md:px-4">
        <span className={cn("shrink-0 text-sm font-semibold", labelClassName)}>
          {label}
        </span>

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
            <p className="truncate text-sm font-semibold">
              {reservation.applicantCohort === null ? null : (
                <span>{reservation.applicantCohort}기 </span>
              )}
              {reservation.applicantName}
            </p>

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
        label={label}
        labelClassName={labelClassName}
        detail={detail}
        onChange={onDetailChange}
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
        <span className="ml-auto text-sm text-muted-foreground">예약 마감</span>
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
        예약
      </span>
    </button>
  );
}

function KaraokeBookingScreen() {
  const { profile } = useAppShell();
  const today = useKoreaToday();
  const weekStart = useMemo(() => startOfKoreaWeek(today), [today]);
  const [selection, setSelection] = useState(() => ({
    weekStart,
    day: initialDay(today),
  }));
  const selectedDay =
    selection.weekStart === weekStart ? selection.day : initialDay(today);

  const [openKey, setOpenKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // 주는 고정이고 route가 바뀌면 다시 mount되므로, 로딩은 mount 직후 한 번뿐이다.
  const [loadedWeek, setLoadedWeek] = useState<string | null>(null);
  const [reservations, setReservations] = useState<
    Record<string, UtilityReservation>
  >({});
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);

  const dates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const selectedDate = dates[selectedDay] ?? weekStart;
  const weekEnd = dates[6] ?? weekStart;
  const loading = loadedWeek !== weekStart;

  useEffect(() => {
    const refresh = () => setRefreshVersion((current) => current + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void loadUtilityReservations("karaoke", weekStart, weekEnd)
      .then((rows) => {
        if (cancelled) return;

        setReservations(
          Object.fromEntries(
            rows.map((row) => [
              reservationKey(row.reservationDate, row.slot),
              row,
            ]),
          ),
        );
      })
      .catch((error: unknown) => {
        console.error("Failed to load utility reservations", error);
      })
      .finally(() => {
        if (cancelled) return;

        setLoadedWeek(weekStart);
      });

    return () => {
      cancelled = true;
    };
  }, [weekStart, weekEnd, refreshVersion]);

  const saveReservation = async (slot: string) => {
    const key = reservationKey(selectedDate, slot);
    const detail = (drafts[key] ?? "").trim();
    if (!detail || mutationKey) return;

    setMutationKey(key);
    setError(null);

    try {
      const created = await createUtilityReservation({
        profileId: profile.id,
        mode: "karaoke",
        reservationDate: selectedDate,
        slot,
        location: null,
        detail,
        recurring: false,
      });

      setReservations((current) => ({ ...current, [key]: created }));
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setOpenKey(null);
    } catch (error) {
      console.error("Failed to create utility reservation", error);
      setError(reservationCreateErrorMessage(error, false));
      setRefreshVersion((current) => current + 1);
    } finally {
      setMutationKey(null);
    }
  };

  const cancelReservation = async (key: string) => {
    const reservation = reservations[key];
    if (!reservation || mutationKey) return;

    setMutationKey(key);
    setError(null);

    try {
      await deleteUtilityReservation(reservation.id);
      setReservations((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setOpenKey(null);
    } catch (error) {
      console.error("Failed to delete utility reservation", error);
      setError(reservationCancelErrorMessage(error));
      setRefreshVersion((current) => current + 1);
    } finally {
      setMutationKey(null);
    }
  };

  const weekend = isWeekend(selectedDate);
  const slots = weekend ? WEEKEND_SLOTS : WEEKDAY_SLOTS;

  // 주말 라벨만 "08:00–09:00"처럼 길다. 평일은 좁게 잡아야 이름과 명단이 덜 잘린다.
  const labelClassName = weekend ? "w-28 tabular-nums" : "w-16";

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-10 md:px-0">
      <h1 className="mb-4 hidden text-2xl font-semibold md:block">
        공강 · 노래방
      </h1>

      <UtilityModeTabs mode="karaoke" />
      <UtilityManagers mode="karaoke" className="mt-4" />

      <p className="mt-4 px-1 text-xs font-medium text-muted-foreground tabular-nums">
        {rangeDateFormatter.format(calendarDate(weekStart))} –{" "}
        {rangeDateFormatter.format(calendarDate(weekEnd))}
      </p>

      <div className="mt-1">
        <WeekStrip
          dates={dates}
          selectedDay={selectedDay}
          onSelect={(day) => {
            setSelection({ weekStart, day });
            setOpenKey(null);
            setError(null);
          }}
          today={today}
        />
      </div>

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
            {slots.map((slot) => {
              const key = reservationKey(selectedDate, slot.id);
              const reservation = reservations[key];

              return (
                <BookingRow
                  key={key}
                  label={slot.label}
                  labelClassName={labelClassName}
                  reservation={reservation}
                  detail={drafts[key] ?? ""}
                  open={openKey === key}
                  onOpen={() => {
                    setOpenKey(key);
                    setError(null);
                  }}
                  onDetailChange={(detail) =>
                    setDrafts((current) => ({ ...current, [key]: detail }))
                  }
                  onClose={() => setOpenKey(null)}
                  onSave={() => void saveReservation(slot.id)}
                  onCancel={() => void cancelReservation(key)}
                  saving={mutationKey === key}
                  canCancel={
                    reservation?.profileId === profile.id &&
                    selectedDate >= today
                  }
                  canBook={selectedDate >= today}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function UtilityBookingScreen({ mode }: { mode: UtilityMode }) {
  return mode === "gongang" ? (
    <GongangBookingScreen />
  ) : (
    <KaraokeBookingScreen />
  );
}

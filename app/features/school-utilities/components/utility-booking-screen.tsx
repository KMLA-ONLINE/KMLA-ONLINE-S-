import { Repeat2Icon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { useAppShell } from "~/features/app-shell";
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";

export type UtilityMode = "gongang" | "karaoke";

interface UtilityBookingScreenProps {
  mode: UtilityMode;
}

interface Slot {
  id: string;
  label: string;
}

interface Reservation {
  applicantName: string;
  avatarUrl: string | null;
  detail: string;
  recurring: boolean;
}

interface Draft {
  detail: string;
  recurring: boolean;
}

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

const rangeDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
});

const weekdayFormatter = new Intl.DateTimeFormat("ko-KR", {
  weekday: "short",
});

const dayFormatter = new Intl.DateTimeFormat("ko-KR", {
  day: "numeric",
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

interface ReservationEditorProps {
  mode: UtilityMode;
  draft: Draft;
  onChange: (draft: Draft) => void;
  onClose: () => void;
  onSave: () => void;
}

function ReservationEditor({
  mode,
  draft,
  onChange,
  onClose,
  onSave,
}: ReservationEditorProps) {
  return (
    <div className="space-y-2.5 rounded-xl bg-muted/60 p-2.5">
      <Input
        value={draft.detail}
        placeholder={mode === "gongang" ? "목적" : "사용자 명단"}
        autoComplete="off"
        onChange={(event) =>
          onChange({
            ...draft,
            detail: event.target.value,
          })
        }
      />

      <div className="flex items-center justify-between gap-2">
        {mode === "gongang" ? (
          <label className="flex h-8 cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={draft.recurring}
              className="size-4 accent-primary"
              onChange={(event) =>
                onChange({
                  ...draft,
                  recurring: event.target.checked,
                })
              }
            />
            장기
          </label>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="닫기"
            onClick={onClose}
          >
            <XIcon />
          </Button>

          <Button
            type="button"
            size="sm"
            disabled={!draft.detail.trim()}
            onClick={onSave}
          >
            신청
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReservationInfo({
  reservation,
  onCancel,
}: {
  reservation: Reservation;
  onCancel: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <UserAvatar
        src={reservation.avatarUrl}
        name={reservation.applicantName}
        size="sm"
        className="shrink-0"
      />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-sm font-semibold">
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
        aria-label="예약 취소"
        onClick={onCancel}
      >
        <XIcon />
      </Button>
    </div>
  );
}

interface GongangSlotProps {
  slot: Slot;
  date: Date;
  reservations: Record<string, Reservation>;
  recurringReservations: Record<string, Reservation>;
  drafts: Record<string, Draft>;
  openKey: string | null;
  onOpen: (key: string) => void;
  onDraftChange: (key: string, draft: Draft) => void;
  onClose: () => void;
  onSave: (key: string, recurringKeyValue: string, draft: Draft) => void;
  onCancel: (
    key: string,
    recurringKeyValue: string,
    recurring: boolean,
  ) => void;
}

function GongangSlot({
  slot,
  date,
  reservations,
  recurringReservations,
  drafts,
  openKey,
  onOpen,
  onDraftChange,
  onClose,
  onSave,
  onCancel,
}: GongangSlotProps) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <h2 className="border-b px-3 py-2.5 text-sm font-semibold">
        {slot.label}
      </h2>

      <div className="divide-y">
        {FLOORS.map((floor) => {
          const key = reservationKey("gongang", date, slot.id, floor.id);
          const repeatKey = recurringKey("gongang", date, slot.id, floor.id);
          const directReservation = reservations[key];
          const repeatingReservation = recurringReservations[repeatKey];
          const reservation = directReservation ?? repeatingReservation;
          const draft = drafts[key] ?? emptyDraft();

          return (
            <div key={floor.id} className="p-3">
              <div className="flex min-h-8 items-center gap-3">
                <p className="w-14 shrink-0 text-sm font-semibold">
                  {floor.label}
                </p>

                <div className="min-w-0 flex-1">
                  {reservation ? (
                    <ReservationInfo
                      reservation={reservation}
                      onCancel={() =>
                        onCancel(key, repeatKey, reservation.recurring)
                      }
                    />
                  ) : openKey === key ? (
                    <ReservationEditor
                      mode="gongang"
                      draft={draft}
                      onChange={(next) => onDraftChange(key, next)}
                      onClose={onClose}
                      onSave={() => onSave(key, repeatKey, draft)}
                    />
                  ) : (
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onOpen(key)}
                      >
                        신청
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function UtilityBookingScreen({ mode }: UtilityBookingScreenProps) {
  const { profile } = useAppShell();
  const [weekStart] = useState(() => startOfWeek(new Date()));
  const [selectedDay, setSelectedDay] = useState(initialDay);
  const [selectedSlot, setSelectedSlot] = useState(GONGANG_SLOTS[0]?.id ?? "");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [reservations, setReservations] = useState<Record<string, Reservation>>(
    {},
  );
  const [recurringReservations, setRecurringReservations] = useState<
    Record<string, Reservation>
  >({});

  const dates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const selectedDate = dates[selectedDay] ?? weekStart;
  const weekEnd = dates[6] ?? weekStart;

  const karaokeSlots = isWeekend(selectedDate)
    ? WEEKEND_KARAOKE_SLOTS
    : WEEKDAY_KARAOKE_SLOTS;

  const updateDraft = (key: string, draft: Draft) => {
    setDrafts((current) => ({
      ...current,
      [key]: draft,
    }));
  };

  const saveReservation = (key: string, repeatKey: string, draft: Draft) => {
    const detail = draft.detail.trim();
    if (!detail) return;

    const reservation: Reservation = {
      applicantName: profile.name,
      avatarUrl: profile.avatar_url,
      detail,
      recurring: mode === "gongang" && draft.recurring,
    };

    if (reservation.recurring) {
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
  };

  const cancelReservation = (
    key: string,
    repeatKey: string,
    recurring: boolean,
  ) => {
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
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-3 pb-6 md:px-0 md:pb-10">
      <div className="space-y-3 md:space-y-5">
        <h1 className="hidden text-2xl font-semibold md:block">
          공강 · 노래방
        </h1>

        <nav
          aria-label="공강 및 노래방"
          className="grid grid-cols-2 rounded-xl bg-muted p-1"
        >
          <Link
            to="/util/gongang"
            className={cn(
              "rounded-lg px-3 py-2 text-center text-sm font-semibold transition-colors",
              mode === "gongang"
                ? "bg-background shadow-sm"
                : "text-muted-foreground",
            )}
          >
            공강
          </Link>

          <Link
            to="/util/karaoke"
            className={cn(
              "rounded-lg px-3 py-2 text-center text-sm font-semibold transition-colors",
              mode === "karaoke"
                ? "bg-background shadow-sm"
                : "text-muted-foreground",
            )}
          >
            노래방
          </Link>
        </nav>

        <section className="rounded-xl border bg-card p-2">
          <p className="px-1 pb-1.5 text-sm font-semibold tabular-nums">
            {rangeDateFormatter.format(weekStart)} –{" "}
            {rangeDateFormatter.format(weekEnd)}
          </p>

          <div className="grid grid-cols-7 gap-1">
            {dates.map((date, position) => {
              const selected = position === selectedDay;

              return (
                <button
                  key={dateKey(date)}
                  type="button"
                  aria-label={fullDateFormatter.format(date)}
                  aria-pressed={selected}
                  onClick={() => {
                    setSelectedDay(position);
                    setOpenKey(null);
                  }}
                  className={cn(
                    "flex min-w-0 touch-manipulation flex-col items-center rounded-lg px-1 py-2 transition-colors",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className="text-[11px] font-medium sm:text-xs">
                    {weekdayFormatter.format(date).replace(".", "")}
                  </span>
                  <span className="mt-0.5 text-sm font-semibold tabular-nums">
                    {dayFormatter.format(date)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {mode === "gongang" ? (
          <>
            <div className="grid grid-cols-3 rounded-xl bg-muted p-1 lg:hidden">
              {GONGANG_SLOTS.map((slot) => (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => {
                    setSelectedSlot(slot.id);
                    setOpenKey(null);
                  }}
                  className={cn(
                    "rounded-lg px-2 py-2 text-sm font-semibold transition-colors",
                    selectedSlot === slot.id
                      ? "bg-background shadow-sm"
                      : "text-muted-foreground",
                  )}
                >
                  {slot.label}
                </button>
              ))}
            </div>

            <div className="lg:hidden">
              {GONGANG_SLOTS.filter((slot) => slot.id === selectedSlot).map(
                (slot) => (
                  <GongangSlot
                    key={slot.id}
                    slot={slot}
                    date={selectedDate}
                    reservations={reservations}
                    recurringReservations={recurringReservations}
                    drafts={drafts}
                    openKey={openKey}
                    onOpen={setOpenKey}
                    onDraftChange={updateDraft}
                    onClose={() => setOpenKey(null)}
                    onSave={saveReservation}
                    onCancel={cancelReservation}
                  />
                ),
              )}
            </div>

            <div className="hidden gap-3 lg:grid lg:grid-cols-3">
              {GONGANG_SLOTS.map((slot) => (
                <GongangSlot
                  key={slot.id}
                  slot={slot}
                  date={selectedDate}
                  reservations={reservations}
                  recurringReservations={recurringReservations}
                  drafts={drafts}
                  openKey={openKey}
                  onOpen={setOpenKey}
                  onDraftChange={updateDraft}
                  onClose={() => setOpenKey(null)}
                  onSave={saveReservation}
                  onCancel={cancelReservation}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {karaokeSlots.map((slot) => {
              const key = reservationKey("karaoke", selectedDate, slot.id);
              const reservation = reservations[key];
              const draft = drafts[key] ?? emptyDraft();

              return (
                <section
                  key={slot.id}
                  className="rounded-xl border bg-card p-3"
                >
                  <div className="flex min-h-8 items-center gap-3">
                    <h2 className="min-w-0 flex-1 text-sm font-semibold tabular-nums">
                      {slot.label}
                    </h2>

                    {!reservation && openKey !== key ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setOpenKey(key)}
                      >
                        신청
                      </Button>
                    ) : null}
                  </div>

                  {reservation ? (
                    <div className="mt-3">
                      <ReservationInfo
                        reservation={reservation}
                        onCancel={() => cancelReservation(key, "", false)}
                      />
                    </div>
                  ) : openKey === key ? (
                    <div className="mt-3">
                      <ReservationEditor
                        mode="karaoke"
                        draft={draft}
                        onChange={(next) => updateDraft(key, next)}
                        onClose={() => setOpenKey(null)}
                        onSave={() => saveReservation(key, "", draft)}
                      />
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

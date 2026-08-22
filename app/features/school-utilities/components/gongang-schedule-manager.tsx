import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { useAppShell } from "~/features/app-shell";
import {
  canManageGongang,
  loadGongangSchedule,
  saveGongangSchedule,
} from "~/features/school-utilities/data/gongang-schedule";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";

const FLOORS = [
  { id: "floor_b1", label: "지하 1층" },
  { id: "floor_2", label: "2층" },
  { id: "floor_4", label: "4층" },
  { id: "floor_10", label: "10층" },
] as const;

const NORMAL_SLOTS = [
  { id: "study-1", label: "1자습" },
  { id: "honjeong-end", label: "혼정끝" },
  { id: "study-2", label: "2자습" },
] as const;

const HOURLY_SLOTS = Array.from({ length: 11 }, (_, position) => {
  const start = position + 8;

  return {
    id: `hour-${start}`,
    label: `${String(start).padStart(2, "0")}:00–${String(start + 1).padStart(
      2,
      "0",
    )}:00`,
  };
});

interface ScheduleDraft {
  reserved: boolean;
  detail: string;
}

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

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function scheduleKey(date: string, slot: string, location: string) {
  return `${date}:${slot}:${location}`;
}

const weekdayFormatter = new Intl.DateTimeFormat("ko-KR", {
  weekday: "short",
});

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
});

export function GongangScheduleManager() {
  const { profile } = useAppShell();

  const nextWeekStart = useMemo(() => addDays(startOfWeek(new Date()), 7), []);

  const dates = useMemo(
    () =>
      Array.from({ length: 7 }, (_, position) =>
        addDays(nextWeekStart, position),
      ),
    [nextWeekStart],
  );

  const nextWeekEnd = dates[6] ?? nextWeekStart;

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState("study-1");
  const [schedule, setSchedule] = useState<Record<string, ScheduleDraft>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedDate = dates[selectedDay] ?? nextWeekStart;
  const weekend = selectedDate.getDay() === 0 || selectedDate.getDay() === 6;

  const slots = weekend
    ? [...HOURLY_SLOTS, ...NORMAL_SLOTS]
    : [...NORMAL_SLOTS];

  const activeSlot = slots.some((slot) => slot.id === selectedSlot)
    ? selectedSlot
    : (slots[0]?.id ?? "");

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      canManageGongang(profile.id),
      loadGongangSchedule(dateKey(nextWeekStart), dateKey(nextWeekEnd)),
    ])
      .then(([canManage, entries]) => {
        if (cancelled) return;

        setAllowed(canManage);

        const next: Record<string, ScheduleDraft> = {};

        for (const entry of entries) {
          next[scheduleKey(entry.scheduleDate, entry.slot, entry.location)] = {
            reserved: entry.reserved,
            detail: entry.detail ?? "",
          };
        }

        setSchedule(next);
      })
      .catch((loadError: unknown) => {
        console.error("Failed to load gongang schedule", loadError);

        if (!cancelled) {
          setAllowed(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [profile.id, nextWeekStart, nextWeekEnd]);

  if (allowed === null) {
    return (
      <div className="flex justify-center py-20">
        <Spinner aria-label="공강 설정 불러오는 중" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <h1 className="text-xl font-semibold">접근 권한이 없습니다</h1>

        <Link
          to="/util/gongang"
          className="mt-4 inline-block text-sm font-medium text-primary"
        >
          공강으로 돌아가기
        </Link>
      </div>
    );
  }

  const saveCurrentSlot = async () => {
    const selectedDateKey = dateKey(selectedDate);

    const entries = FLOORS.map((floor) => {
      const key = scheduleKey(selectedDateKey, activeSlot, floor.id);

      const draft = schedule[key] ?? {
        reserved: false,
        detail: "",
      };

      return {
        scheduleDate: selectedDateKey,
        slot: activeSlot,
        location: floor.id,
        reserved: draft.reserved,
        detail: draft.reserved ? draft.detail.trim() : null,
      };
    });

    const missingDetail = entries.some(
      (entry) => entry.reserved && !entry.detail?.trim(),
    );

    if (missingDetail) {
      setMessage(null);
      setError("선예약할 공강의 목적을 입력해주세요.");
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      await saveGongangSchedule(entries);
      setMessage("저장되었습니다.");
    } catch (saveError) {
      console.error("Failed to save gongang schedule", saveError);
      setError("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-10 md:px-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">다음 주 공강 선예약</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            미리 사용할 공강과 목적을 입력합니다.
          </p>
        </div>

        <Link to="/util/gongang" className="text-sm font-medium text-primary">
          돌아가기
        </Link>
      </div>

      <div className="mt-5 grid grid-cols-7 gap-1">
        {dates.map((date, position) => (
          <button
            key={dateKey(date)}
            type="button"
            onClick={() => {
              setSelectedDay(position);
              setSelectedSlot("study-1");
              setMessage(null);
              setError(null);
            }}
            className={cn(
              "rounded-lg px-1 py-2 text-center text-sm",
              selectedDay === position
                ? "bg-primary text-primary-foreground"
                : "bg-muted",
            )}
          >
            <span className="block text-xs">
              {weekdayFormatter.format(date)}
            </span>
            <span className="mt-1 block">{dateFormatter.format(date)}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {slots.map((slot) => (
          <button
            key={slot.id}
            type="button"
            onClick={() => {
              setSelectedSlot(slot.id);
              setMessage(null);
              setError(null);
            }}
            className={cn(
              "shrink-0 rounded-lg border px-3 py-2 text-sm font-medium",
              activeSlot === slot.id
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background",
            )}
          >
            {slot.label}
          </button>
        ))}
      </div>

      <div className="mt-4 divide-y overflow-hidden rounded-xl border">
        {FLOORS.map((floor) => {
          const key = scheduleKey(dateKey(selectedDate), activeSlot, floor.id);

          const draft = schedule[key] ?? {
            reserved: false,
            detail: "",
          };

          return (
            <div key={floor.id} className="px-4 py-3">
              <label className="flex min-h-9 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={draft.reserved}
                  onChange={(event) => {
                    setSchedule((current) => ({
                      ...current,
                      [key]: {
                        reserved: event.target.checked,
                        detail: current[key]?.detail ?? "",
                      },
                    }));

                    setMessage(null);
                    setError(null);
                  }}
                  className="size-4"
                />

                <span className="text-sm font-medium">{floor.label}</span>

                <span className="ml-auto text-sm text-muted-foreground">
                  {draft.reserved ? "선예약" : "사용 가능"}
                </span>
              </label>

              {draft.reserved ? (
                <Input
                  value={draft.detail}
                  placeholder="사용 목적"
                  maxLength={200}
                  className="mt-2"
                  onChange={(event) => {
                    setSchedule((current) => ({
                      ...current,
                      [key]: {
                        reserved: true,
                        detail: event.target.value,
                      },
                    }));

                    setMessage(null);
                    setError(null);
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {message ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}

      <Button
        type="button"
        className="mt-4 w-full"
        disabled={saving}
        onClick={() => {
          void saveCurrentSlot();
        }}
      >
        {saving ? "저장 중..." : "선예약 저장"}
      </Button>
    </div>
  );
}

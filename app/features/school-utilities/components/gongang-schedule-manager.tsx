import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { useAppShell } from "~/features/app-shell";
import {
  canManageGongang,
  loadGongangSchedule,
  saveGongangSchedule,
  type GongangScheduleEntry,
} from "../data/gongang-schedule";
import {
  loadUtilityReservations,
  type UtilityReservation,
} from "../data/reservations";
import {
  addCalendarDays,
  startOfKoreaWeek,
  useKoreaToday,
} from "../model/korea-date";
import { gongangEntries, occursOn } from "../model/gongang-entries";
import {
  GONGANG_FLOORS,
  gongangKey,
  gongangSlots,
} from "../model/gongang-slots";
import { GongangBoard, type GongangBoardEntry } from "./gongang-board";
import { GongangWeekStrip } from "./gongang-week-strip";
import { Button } from "~/shared/ui/button";
import { TextField } from "~/shared/ui/text-field";
import { Spinner } from "~/shared/ui/spinner";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "~/shared/ui/dialog";

export function GongangScheduleManager() {
  const { profile } = useAppShell();
  const today = useKoreaToday();
  const week = addCalendarDays(startOfKoreaWeek(today), 7);
  const dates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addCalendarDays(week, i)),
    [week],
  );
  const [chosen, setChosen] = useState(week);
  const date = dates.includes(chosen) ? chosen : week;
  const [allowed, setAllowed] = useState<boolean | null>(
    profile.role === "admin" ? true : null,
  );
  const [schedules, setSchedules] = useState<GongangScheduleEntry[]>([]);
  const [reservations, setReservations] = useState<UtilityReservation[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [version, setVersion] = useState(0);
  const [inspected, setInspected] = useState<GongangBoardEntry | null>(null);
  const [pending, setPending] = useState<GongangScheduleEntry[] | null>(null);
  const entries = gongangEntries(date, reservations, schedules, profile.id);
  // Existing user repeats can be selected by managers; they require a separate impact confirmation.
  const boardEntries = entries;
  const conflicts = reservations.filter(
    (row) =>
      row.recurring &&
      occursOn(row, date) &&
      row.location &&
      selected.includes(gongangKey(row.slot, row.location)),
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const permitted =
        profile.role === "admin" || (await canManageGongang(profile.id));
      if (!active) return;
      setAllowed(permitted);
      if (!permitted) {
        setLoading(false);
        return;
      }
      const [next, nextReservations] = await Promise.all([
        loadGongangSchedule(week, dates[6]),
        loadUtilityReservations("gongang", week, dates[6]),
      ]);
      if (!active) return;
      setSchedules(next);
      setReservations(nextReservations);
      setLoadError("");
      setLoading(false);
    })().catch(() => {
      if (active) {
        setLoadError("선예약을 불러오지 못했습니다. 다시 시도해주세요.");
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [profile.id, profile.role, week, dates, version]);

  async function save(next: GongangScheduleEntry[]) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await saveGongangSchedule(next);
      setLoading(true);
      setSelected([]);
      setDetail("");
      setRecurring(false);
      setInspected(null);
      setVersion((v) => v + 1);
      toast.success("선예약을 저장했습니다.");
    } catch {
      setError("저장하지 못했습니다. 예약 현황을 확인한 뒤 다시 시도해주세요.");
      setVersion((v) => v + 1);
    } finally {
      setBusy(false);
      setPending(null);
    }
  }
  function submit() {
    if (!selected.length || !detail.trim() || busy) return;
    const next = selected.map((key) => {
      const [slot, location] = key.split(":");
      return {
        scheduleDate: date,
        slot: slot,
        location: location,
        reserved: true,
        detail: detail.trim(),
        recurring,
        recurringUntil: null,
      };
    });
    if (conflicts.length > 0) setPending(next);
    else void save(next);
  }
  const slots = gongangSlots(date);
  if (allowed === false)
    return (
      <div className="p-4">
        <p>접근 권한이 없습니다.</p>
        <Link to="/menu/gongang" className="text-primary">
          공강으로 돌아가기
        </Link>
      </div>
    );
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-3 pb-6 sm:px-4 md:px-0">
      <div className="flex min-h-12 items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">다음 주 선예약</h1>
        <Link
          to="/menu/gongang"
          className="inline-flex min-h-11 items-center text-sm text-primary"
        >
          공강으로 돌아가기
        </Link>
      </div>
      <GongangWeekStrip
        dates={dates}
        selected={date}
        disabled={busy}
        onSelect={(next) => {
          setChosen(next);
          setSelected([]);
          setError("");
          setInspected(null);
        }}
      />
      {loadError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 text-sm text-destructive"
        >
          <p>{loadError}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setVersion((v) => v + 1)}
          >
            다시 시도
          </Button>
        </div>
      )}
      {loading && (
        <div className="flex justify-center py-16">
          <Spinner aria-label="예약 불러오는 중" />
        </div>
      )}
      <div hidden={loading}>
        <GongangBoard
          key={date}
          date={date}
          entries={boardEntries}
          allowPreempt
          selected={selected}
          disabled={busy || Boolean(loadError)}
          onInspect={setInspected}
          onSelect={(slot, location) => {
            const key = gongangKey(slot, location);
            setSelected((values) =>
              values.includes(key)
                ? values.filter((value) => value !== key)
                : [...values, key],
            );
            setError("");
          }}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {selected.length > 0 && (
        <form
          className="sticky bottom-0 z-10 space-y-3 rounded-xl border bg-background p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <p
            className="max-h-16 overflow-y-auto text-xs text-muted-foreground"
            aria-live="polite"
          >
            {selected
              .map((key) => {
                const [slot, location] = key.split(":");
                return `${GONGANG_FLOORS.find((floor) => floor.id === location)?.label} ${slots.find((item) => item.id === slot)?.label}`;
              })
              .join(" · ")}
          </p>
          <TextField
            aria-label="사용 목적"
            placeholder="사용 목적"
            name="purpose"
            autoComplete="off"
            value={detail}
            disabled={busy}
            maxLength={200}
            onChange={(event) => setDetail(event.target.value)}
          />
          {conflicts.length > 0 && (
            <p className="text-xs text-destructive">
              기존 장기 예약 {conflicts.length}건이 종료됩니다.
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={recurring}
                disabled={busy}
                onChange={(event) => setRecurring(event.target.checked)}
              />
              매주 반복
            </label>
            <Button type="submit" disabled={busy || !detail.trim()}>
              {busy && <Spinner />}
              {selected.length}건 선예약
            </Button>
          </div>
        </form>
      )}
      {pending && (
        <ConfirmDialog
          title={
            pending.some((entry) => entry.reserved)
              ? "장기 예약 종료"
              : "선예약 취소"
          }
          description={
            pending.some((entry) => entry.reserved) ? (
              <>
                {conflicts
                  .map(
                    (row) =>
                      `${row.applicantName} · ${GONGANG_FLOORS.find((floor) => floor.id === row.location)?.label} ${slots.find((slot) => slot.id === row.slot)?.label}`,
                  )
                  .join(", ")}
                <br />이 날짜부터 해당 장기 예약이 종료되며 자동으로 복구되지
                않습니다.
              </>
            ) : (
              "선택한 날짜부터 선예약을 해제합니다. 과거 기록은 유지됩니다."
            )
          }
          confirmLabel={
            pending.some((entry) => entry.reserved)
              ? "종료하고 선예약"
              : "선예약 취소"
          }
          destructive
          pending={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void save(pending)}
        />
      )}
      {inspected && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setInspected(null);
          }}
        >
          <DialogContent>
            <DialogTitle>
              {
                GONGANG_FLOORS.find((floor) => floor.id === inspected.location)
                  ?.label
              }{" "}
              · {slots.find((slot) => slot.id === inspected.slot)?.label}
            </DialogTitle>
            <DialogDescription>
              {inspected.recurring ? "매주 반복 선예약" : "선예약"}
            </DialogDescription>
            <p className="break-words">{inspected.detail}</p>
            <DialogFooter>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  setInspected(null);
                  setPending([
                    {
                      scheduleDate: date,
                      slot: inspected.slot,
                      location: inspected.location,
                      reserved: false,
                      detail: null,
                      recurring: false,
                      recurringUntil: null,
                    },
                  ]);
                }}
              >
                {inspected.recurring ? "이 날짜부터 종료" : "선예약 취소"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

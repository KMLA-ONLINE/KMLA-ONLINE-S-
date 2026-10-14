import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { useAppShell } from "~/features/app-shell";
import {
  canManageGongang,
  loadGongangSchedule,
  type GongangScheduleEntry,
} from "../data/gongang-schedule";
import {
  createUtilityReservations,
  deleteUtilityReservation,
  loadUtilityReservations,
  type UtilityReservation,
} from "../data/reservations";
import {
  reservationCancelErrorMessage,
  reservationCreateErrorMessage,
} from "../model/reservation-error";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "~/shared/ui/dialog";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";

export function GongangBookingScreen() {
  const { profile } = useAppShell();
  const today = useKoreaToday();
  const week = startOfKoreaWeek(today);
  const dates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addCalendarDays(week, i)),
    [week],
  );
  const [chosen, setChosen] = useState(today);
  const date = dates.includes(chosen) ? chosen : today;
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [reservations, setReservations] = useState<UtilityReservation[]>([]);
  const [schedules, setSchedules] = useState<GongangScheduleEntry[]>([]);
  const [canManage, setCanManage] = useState(profile.role === "admin");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [inspected, setInspected] = useState<GongangBoardEntry | null>(null);
  const [cancelTarget, setCancelTarget] = useState<UtilityReservation | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    if (profile.role !== "admin")
      void canManageGongang(profile.id)
        .then((value) => {
          if (active) setCanManage(value);
        })
        .catch(() => {
          // Management remains hidden if its permission lookup fails.
        });
    return () => {
      active = false;
    };
  }, [profile.id, profile.role]);
  useEffect(() => {
    const refresh = () => setVersion((v) => v + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([
      loadUtilityReservations("gongang", week, dates[6]),
      loadGongangSchedule(week, dates[6]),
    ])
      .then(([next, nextSchedules]) => {
        if (!active) return;
        setReservations(next);
        setSchedules(nextSchedules);
        setLoadError("");
      })
      .catch(() => {
        if (active)
          setLoadError("예약을 불러오지 못했습니다. 다시 시도해주세요.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [week, dates, version]);
  const entries = gongangEntries(date, reservations, schedules, profile.id);
  const selection = (chosen === date ? selected : []).filter(
    (key) =>
      !entries.some((entry) => gongangKey(entry.slot, entry.location) === key),
  );
  const inspectedReservation = inspected
    ? reservations.find(
        (row) =>
          row.slot === inspected.slot &&
          row.location === inspected.location &&
          occursOn(row, date),
      )
    : undefined;

  async function submit() {
    if (!selection.length || !detail.trim() || busy || date < today) return;
    setBusy(true);
    setError("");
    try {
      await createUtilityReservations(
        selection.map((key) => {
          const [slot, location] = key.split(":");
          return {
            profileId: profile.id,
            mode: "gongang",
            reservationDate: date,
            slot: slot,
            location: location,
            detail: detail.trim(),
            recurring,
          };
        }),
      );
      setLoading(true);
      setSelected([]);
      setDetail("");
      setRecurring(false);
      setVersion((v) => v + 1);
      toast.success(`${selection.length}건 신청 완료`);
    } catch (e) {
      setError(reservationCreateErrorMessage(e, recurring));
      setVersion((v) => v + 1);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!cancelTarget || busy) return;
    setBusy(true);
    try {
      await deleteUtilityReservation(
        cancelTarget.id,
        cancelTarget.recurring ? date : undefined,
      );
      setLoading(true);
      setCancelTarget(null);
      setInspected(null);
      setVersion((v) => v + 1);
      toast.success("예약을 취소했습니다.");
    } catch (e) {
      setError(reservationCancelErrorMessage(e));
      setCancelTarget(null);
      setInspected(null);
    } finally {
      setBusy(false);
    }
  }
  const slots = gongangSlots(date);
  const summary = selection
    .map((key) => {
      const [slot, location] = key.split(":");
      return `${GONGANG_FLOORS.find((floor) => floor.id === location)?.label} ${slots.find((item) => item.id === slot)?.label}`;
    })
    .join(" · ");

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-3 pb-6 sm:px-4 md:px-0">
      <nav aria-label="공강 및 노래방" className="flex border-b">
        <Link
          to="/menu/gongang"
          aria-current="page"
          className="flex min-h-11 flex-1 items-center justify-center border-b-2 border-primary text-sm font-medium text-primary"
        >
          공강
        </Link>
        <Link
          to="/menu/karaoke"
          className="flex min-h-11 flex-1 items-center justify-center text-sm text-muted-foreground"
        >
          노래방
        </Link>
      </nav>
      {canManage && (
        <div className="flex justify-end">
          <Button
            render={<Link to="/menu/gongang/manage" />}
            variant="outline"
            size="sm"
          >
            선예약 관리
          </Button>
        </div>
      )}
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
            variant="outline"
            size="sm"
            onClick={() => setVersion((v) => v + 1)}
          >
            다시 시도
          </Button>
        </div>
      )}
      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner aria-label="예약 불러오는 중" />
        </div>
      ) : (
        <GongangBoard
          key={date}
          date={date}
          entries={entries}
          selected={selection}
          disabled={busy || Boolean(loadError)}
          onSelect={(slot, location) => {
            if (date < today) return;
            const key = gongangKey(slot, location);
            setSelected((values) =>
              values.includes(key)
                ? values.filter((value) => value !== key)
                : [...values, key],
            );
            setError("");
          }}
          onInspect={setInspected}
        />
      )}
      {date < today && (
        <p className="text-center text-xs text-muted-foreground">
          지난 날짜입니다.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {selection.length > 0 && date >= today && (
        <form
          className="sticky bottom-0 z-10 space-y-3 rounded-xl border bg-background p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p
            className="max-h-16 overflow-y-auto text-xs text-muted-foreground"
            aria-live="polite"
          >
            {summary}
          </p>
          <TextField
            aria-label="사용 목적"
            placeholder="사용 목적"
            name="purpose"
            autoComplete="off"
            maxLength={200}
            value={detail}
            disabled={busy}
            onChange={(event) => setDetail(event.target.value)}
          />
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
              {busy && <Spinner />} {selection.length}건 신청
            </Button>
          </div>
        </form>
      )}
      {inspected && !cancelTarget && (
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
              {inspected.label}
              {inspected.recurring && " · 매주 반복"}
            </DialogDescription>
            <p className="break-words">{inspected.detail}</p>
            {inspected.state !== "manager" && inspectedReservation && (
              <Link
                to={`/profile/${inspectedReservation.applicantPubId}`}
                className="text-sm text-primary"
              >
                {inspectedReservation.applicantName}
              </Link>
            )}
            {inspected.state === "mine" &&
              inspectedReservation &&
              date >= today && (
                <DialogFooter>
                  <Button
                    variant="destructive"
                    onClick={() => setCancelTarget(inspectedReservation)}
                  >
                    예약 취소
                  </Button>
                </DialogFooter>
              )}
          </DialogContent>
        </Dialog>
      )}
      {cancelTarget && (
        <ConfirmDialog
          title="예약 취소"
          description={
            cancelTarget.recurring
              ? "이 날짜부터 매주 반복 예약을 종료합니다."
              : "선택한 예약을 취소합니다."
          }
          confirmLabel="예약 취소"
          destructive
          pending={busy}
          onCancel={() => setCancelTarget(null)}
          onConfirm={() => void cancel()}
        />
      )}
    </div>
  );
}

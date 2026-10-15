import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { useAppShell } from "~/features/app-shell";
import {
  canManageGongang,
  saveGongangSchedule,
  type GongangScheduleEntry,
} from "../data/gongang-schedule";
import { useGongangWeek } from "../hooks/use-gongang-week";
import {
  addCalendarDays,
  startOfKoreaWeek,
  useKoreaToday,
} from "../model/korea-date";
import { gongangEntries, occursOn } from "../model/gongang-entries";
import {
  GONGANG_FLOORS,
  gongangCellLabel,
  gongangKey,
  parseGongangKey,
  toggleGongangKey,
} from "../model/gongang-slots";
import { GongangBoard, type GongangBoardEntry } from "./gongang-board";
import { GongangEntryDialog } from "./gongang-entry-dialog";
import {
  GongangLoadError,
  GongangSelectionForm,
} from "./gongang-selection-form";
import { GongangWeekStrip } from "./gongang-week-strip";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";

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
  const [permissionFailed, setPermissionFailed] = useState(false);
  const [permissionAttempt, setPermissionAttempt] = useState(0);
  const [floorId, setFloorId] = useState<string>(GONGANG_FLOORS[0].id);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [inspected, setInspected] = useState<GongangBoardEntry | null>(null);
  const [pending, setPending] = useState<GongangScheduleEntry[] | null>(null);
  const { reservations, schedules, loading, loadFailed, refresh } =
    useGongangWeek(week, dates[6], allowed === true);

  useEffect(() => {
    if (profile.role === "admin") return;
    let active = true;
    void canManageGongang(profile.id)
      .then((value) => {
        if (active) setAllowed(value);
      })
      .catch(() => {
        if (active) setPermissionFailed(true);
      });
    return () => {
      active = false;
    };
  }, [profile.id, profile.role, permissionAttempt]);

  const entries = gongangEntries(date, reservations, schedules, profile.id);
  const conflicts = reservations.filter(
    (row) =>
      row.recurring &&
      occursOn(row, date) &&
      row.location &&
      selected.includes(gongangKey(row.slot, row.location)),
  );

  function changeSelection(next: (values: string[]) => string[]) {
    setSelected(next);
    setError("");
  }

  async function save(next: GongangScheduleEntry[]) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await saveGongangSchedule(next);
      setSelected([]);
      setDetail("");
      setRecurring(false);
      setInspected(null);
      toast.success("선예약을 저장했습니다.");
    } catch {
      setError("저장하지 못했습니다. 예약 현황을 확인한 뒤 다시 시도해주세요.");
    } finally {
      setBusy(false);
      setPending(null);
      refresh();
    }
  }
  function submit() {
    if (!selected.length || !detail.trim() || busy) return;
    const next = selected.map((key) => ({
      ...parseGongangKey(key),
      scheduleDate: date,
      reserved: true,
      detail: detail.trim(),
      recurring,
      recurringUntil: null,
    }));
    if (conflicts.length > 0) setPending(next);
    else void save(next);
  }

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
      {(loadFailed || permissionFailed) && (
        <GongangLoadError
          message="선예약을 불러오지 못했습니다. 다시 시도해주세요."
          onRetry={() => {
            if (!permissionFailed) return refresh();
            setPermissionFailed(false);
            setPermissionAttempt((value) => value + 1);
          }}
        />
      )}
      {(loading || allowed === null) && !permissionFailed && (
        <div className="flex justify-center py-16">
          <Spinner aria-label="예약 불러오는 중" />
        </div>
      )}
      <div hidden={loading || allowed !== true}>
        <GongangBoard
          date={date}
          floorId={floorId}
          onFloorChange={setFloorId}
          entries={entries}
          allowPreempt
          selected={selected}
          disabled={busy || loadFailed}
          onInspect={setInspected}
          onSelect={(slot, location) =>
            changeSelection((values) =>
              toggleGongangKey(values, gongangKey(slot, location)),
            )
          }
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {selected.length > 0 && (
        <GongangSelectionForm
          date={date}
          selected={selected}
          notice={
            conflicts.length > 0 && (
              <p className="text-xs text-destructive">
                기존 장기 예약 {conflicts.length}건이 종료됩니다.
              </p>
            )
          }
          detail={detail}
          recurring={recurring}
          busy={busy}
          submitLabel={`${selected.length}건 선예약`}
          onRemove={(key) =>
            changeSelection((values) => values.filter((value) => value !== key))
          }
          onClear={() => changeSelection(() => [])}
          onDetailChange={setDetail}
          onRecurringChange={setRecurring}
          onSubmit={submit}
        />
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
                      `${row.applicantName} · ${gongangCellLabel(date, row.slot, row.location ?? "")}`,
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
        <GongangEntryDialog
          date={date}
          entry={inspected}
          onClose={() => setInspected(null)}
          description="선예약"
          actions={
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
          }
        />
      )}
    </div>
  );
}

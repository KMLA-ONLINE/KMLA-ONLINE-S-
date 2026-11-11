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
import { gongangScheduleSaveErrorMessage } from "../model/reservation-error";
import {
  addCalendarDays,
  startOfKoreaWeek,
  useKoreaToday,
} from "../model/korea-date";
import { gongangEntries, occursOn } from "../model/gongang-entries";
import {
  gongangCellLabel,
  gongangKey,
  parseGongangKey,
} from "../model/gongang-slots";
import { GongangBoard, type GongangBoardEntry } from "./gongang-board";
import { GongangEntryDialog } from "./gongang-entry-dialog";
import { ReservationLoadError } from "./reservation-load-error";
import {
  RecurringCheckbox,
  UtilityBookingDialog,
} from "./utility-booking-dialog";
import { UtilityWeekStrip } from "./utility-week-strip";
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
  const [picked, setPicked] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [inspected, setInspected] = useState<GongangBoardEntry | null>(null);
  const [pending, setPending] = useState<GongangScheduleEntry[] | null>(null);
  const { reservations, schedules, loading, loadFailed, ready, refresh } =
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
  const selection = picked && chosen === date ? picked : null;
  // A student's repeat in the picked cell ends from this date once the prebooking saves.
  const conflict = selection
    ? reservations.find(
        (row) =>
          row.recurring &&
          occursOn(row, date) &&
          row.location &&
          gongangKey(row.slot, row.location) === selection,
      )
    : undefined;
  const inspectedReservation =
    inspected && inspected.state !== "manager"
      ? reservations.find(
          (row) =>
            row.slot === inspected.slot &&
            row.location === inspected.location &&
            occursOn(row, date),
        )
      : undefined;

  function pick(key: string | null) {
    setPicked(key);
    setDetail("");
    setRecurring(false);
    setError("");
  }

  async function save(next: GongangScheduleEntry[]) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await saveGongangSchedule(next);
      setPicked(null);
      setDetail("");
      setRecurring(false);
      setInspected(null);
      toast.success("선예약을 저장했습니다.");
    } catch (e) {
      setError(gongangScheduleSaveErrorMessage(e));
    } finally {
      setBusy(false);
      setPending(null);
      refresh();
    }
  }
  function submit() {
    if (!selection || !detail.trim() || busy) return;
    void save([
      {
        ...parseGongangKey(selection),
        scheduleDate: date,
        reserved: true,
        detail: detail.trim(),
        recurring,
        recurringUntil: null,
      },
    ]);
  }

  if (allowed === false)
    return (
      <div className="mx-auto w-full max-w-2xl space-y-2 px-3 py-4 sm:px-4 md:px-0">
        <h1 className="text-lg font-semibold">접근 권한이 없습니다</h1>
        <Link
          to="/menu/gongang"
          className="inline-flex min-h-11 items-center text-sm text-primary"
        >
          공강으로 돌아가기
        </Link>
      </div>
    );
  // Until the grant check answers, show nothing of the manager screen: a user
  // without the grant would otherwise see it flash before the denial.
  if (allowed === null && !permissionFailed)
    return (
      <div className="flex justify-center py-16">
        <Spinner aria-label="예약 불러오는 중" />
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
      <UtilityWeekStrip
        dates={dates}
        selected={date}
        today={today}
        disabled={busy}
        onSelect={(next) => {
          setChosen(next);
          setPicked(null);
          setError("");
          setInspected(null);
        }}
      />
      {(loadFailed || permissionFailed) && (
        <ReservationLoadError
          message="선예약을 불러오지 못했습니다. 다시 시도해 주세요."
          onRetry={() => {
            if (!permissionFailed) return refresh();
            setPermissionFailed(false);
            setPermissionAttempt((value) => value + 1);
          }}
        />
      )}
      {loading && !permissionFailed && (
        <div className="flex justify-center py-16">
          <Spinner aria-label="예약 불러오는 중" />
        </div>
      )}
      <div hidden={loading || !ready || allowed !== true}>
        <GongangBoard
          date={date}
          entries={entries}
          selected={selection ? [selection] : []}
          disabled={busy || loadFailed}
          onInspect={setInspected}
          onSelect={(slot, location) => pick(gongangKey(slot, location))}
        />
      </div>
      {error && !selection && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {selection && (
        <UtilityBookingDialog
          title={gongangCellLabel(
            date,
            parseGongangKey(selection).slot,
            parseGongangKey(selection).location,
          )}
          date={date}
          fieldLabel="사용 목적"
          detail={detail}
          onDetailChange={setDetail}
          error={error}
          busy={busy}
          submitLabel={conflict ? "종료하고 선예약" : "선예약"}
          busyLabel="저장 중…"
          destructive={Boolean(conflict)}
          onSubmit={submit}
          onClose={() => pick(null)}
        >
          <RecurringCheckbox
            checked={recurring}
            disabled={busy}
            onChange={setRecurring}
          />
          {conflict && (
            <p className="text-sm text-destructive">
              {conflict.applicantName}의 장기 예약이 이 날짜부터 종료되며
              자동으로 복구되지 않습니다.
            </p>
          )}
        </UtilityBookingDialog>
      )}
      {pending && (
        <ConfirmDialog
          title="선예약 취소"
          description="선택한 날짜부터 선예약을 해제합니다. 과거 기록은 유지됩니다."
          confirmLabel="선예약 취소"
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
          description={
            inspectedReservation ? (
              <Link
                to={`/profile/${inspectedReservation.applicantPubId}`}
                className="text-primary"
              >
                {inspectedReservation.applicantName}
              </Link>
            ) : (
              inspected.label
            )
          }
          actions={
            inspected.state === "manager" ? (
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
            ) : (
              inspected.recurring && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setInspected(null);
                    pick(gongangKey(inspected.slot, inspected.location));
                  }}
                >
                  선예약으로 대체
                </Button>
              )
            )
          }
        >
          {inspected.state !== "manager" && (
            <p className="text-sm text-muted-foreground">
              {inspected.recurring
                ? "선예약으로 대체하면 이 날짜부터 학생의 장기 예약이 끝납니다."
                : "단발 예약이 있는 칸은 선예약할 수 없습니다."}
            </p>
          )}
        </GongangEntryDialog>
      )}
    </div>
  );
}

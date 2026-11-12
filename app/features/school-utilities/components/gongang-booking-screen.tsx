import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useAppShell } from "~/features/app-shell";
import {
  createUtilityReservations,
  deleteUtilityReservation,
  type UtilityReservation,
} from "../data/reservations";
import { useGongangManagers } from "../hooks/use-gongang-managers";
import { useGongangPick } from "../hooks/use-gongang-pick";
import { useGongangWeek } from "../hooks/use-gongang-week";
import {
  reservationCancelErrorMessage,
  reservationCreateErrorMessage,
  SLOT_TAKEN_MESSAGE,
} from "../model/reservation-error";
import {
  addCalendarDays,
  startOfKoreaWeek,
  useKoreaToday,
} from "../model/korea-date";
import { gongangEntries, occursOn } from "../model/gongang-entries";
import {
  gongangKey,
  gongangKeyLabel,
  parseGongangKey,
} from "../model/gongang-slots";
import { GongangBoard, type GongangBoardEntry } from "./gongang-board";
import { GongangEntryDialog } from "./gongang-entry-dialog";
import { GongangManagers } from "./gongang-managers";
import { ReservationLoadError } from "./reservation-load-error";
import {
  RecurringCheckbox,
  UtilityBookingDialog,
} from "./utility-booking-dialog";
import { UtilityWeekStrip } from "./utility-week-strip";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";
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
  const pick = useGongangPick(date);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [inspected, setInspected] = useState<GongangBoardEntry | null>(null);
  const [cancelTarget, setCancelTarget] = useState<UtilityReservation | null>(
    null,
  );
  const { reservations, schedules, loading, loadFailed, ready, refresh } =
    useGongangWeek(week, dates[6]);
  const { managers, loaded: managersLoaded } = useGongangManagers();
  // 운영자는 역할로, 나머지는 명단에 있으면 선예약을 관리한다. 명단을 못 불러오면 숨긴다.
  const canManage =
    profile.role === "admin" ||
    managers.some((manager) => manager.profileId === profile.id);

  const past = date < today;
  const entries = gongangEntries(date, reservations, schedules, profile.id);
  const occupied = new Set(
    entries.map((entry) => gongangKey(entry.slot, entry.location)),
  );
  // A refresh that shows the open cell taken, or that fails, ends the dialog for good:
  // reopening it on its own later would surprise the user.
  if (pick.key && (occupied.has(pick.key) || loadFailed)) {
    pick.close();
    if (!loadFailed && !error) setError(SLOT_TAKEN_MESSAGE);
  }
  const selection = pick.key;
  const inspectedReservation = inspected
    ? reservations.find(
        (row) =>
          row.slot === inspected.slot &&
          row.location === inspected.location &&
          occursOn(row, date),
      )
    : undefined;

  async function submit() {
    const detail = pick.detail.trim();
    const { recurring } = pick;
    if (!selection || !detail || busy || past) return;
    setBusy(true);
    setError("");
    try {
      await createUtilityReservations([
        {
          ...parseGongangKey(selection),
          profileId: profile.id,
          mode: "gongang",
          reservationDate: date,
          detail,
          recurring,
        },
      ]);
      pick.finish();
    } catch (e) {
      setError(reservationCreateErrorMessage(e, recurring));
    } finally {
      setBusy(false);
      refresh();
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
    } catch (e) {
      setError(reservationCancelErrorMessage(e));
    } finally {
      setCancelTarget(null);
      setInspected(null);
      setBusy(false);
      refresh();
    }
  }

  return (
    <div className="mt-4 space-y-4">
      {/* 명단이 오기 전에도 줄 높이를 잡아 두어 아래 날짜줄과 표가 밀리지 않게 한다. */}
      {(!managersLoaded || managers.length > 0 || canManage) && (
        <div className="flex min-h-8 items-center justify-between gap-3">
          <GongangManagers managers={managers} className="min-w-0" />
          {canManage && (
            <Button
              render={<Link to="/menu/gongang/manage" />}
              variant="outline"
              size="sm"
              className="ml-auto shrink-0"
            >
              선예약 관리
            </Button>
          )}
        </div>
      )}
      <UtilityWeekStrip
        dates={dates}
        selected={date}
        today={today}
        disabled={busy}
        onSelect={(next) => {
          setChosen(next);
          pick.close();
          setError("");
          setInspected(null);
        }}
      />
      {loadFailed && (
        <ReservationLoadError
          message="예약을 불러오지 못했습니다. 다시 시도해 주세요."
          onRetry={refresh}
        />
      )}
      {loading && (
        <div className="flex justify-center py-16">
          <Spinner aria-label="예약 불러오는 중" />
        </div>
      )}
      <div hidden={loading || !ready}>
        <GongangBoard
          date={date}
          entries={entries}
          readOnly={past}
          selected={selection}
          disabled={busy || loadFailed}
          onSelect={(slot, location) => {
            if (past) return;
            setError("");
            pick.open(gongangKey(slot, location));
          }}
          onInspect={setInspected}
        />
      </div>
      {error && !selection && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {selection && !past && (
        <UtilityBookingDialog
          title={gongangKeyLabel(date, selection)}
          date={date}
          fieldLabel="사용 목적"
          detail={pick.detail}
          onDetailChange={pick.setDetail}
          error={error}
          busy={busy}
          submitLabel="예약"
          busyLabel="예약 중…"
          onSubmit={() => void submit()}
          onClose={() => {
            pick.close();
            setError("");
          }}
        >
          <RecurringCheckbox
            checked={pick.recurring}
            disabled={busy}
            onChange={pick.setRecurring}
          />
        </UtilityBookingDialog>
      )}
      {inspected && !cancelTarget && (
        <GongangEntryDialog
          date={date}
          entry={inspected}
          onClose={() => setInspected(null)}
          description={
            inspected.state !== "manager" && inspectedReservation ? (
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
            inspected.state === "mine" &&
            inspectedReservation &&
            !past && (
              <Button
                variant="destructive"
                onClick={() => setCancelTarget(inspectedReservation)}
              >
                예약 취소
              </Button>
            )
          }
        />
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

import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useAppShell } from "~/features/app-shell";
import {
  createUtilityReservations,
  deleteUtilityReservation,
  type UtilityReservation,
} from "../data/reservations";
import { useGongangManagers } from "../hooks/use-gongang-managers";
import { useGongangWeek } from "../hooks/use-gongang-week";
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
  gongangCellLabel,
  gongangKey,
  parseGongangKey,
  toggleGongangKey,
} from "../model/gongang-slots";
import { GongangBoard, type GongangBoardEntry } from "./gongang-board";
import { GongangEntryDialog } from "./gongang-entry-dialog";
import { GongangManagers } from "./gongang-managers";
import { GongangSelectionForm } from "./gongang-selection-form";
import { ReservationLoadError } from "./reservation-load-error";
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
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState("");
  const [recurring, setRecurring] = useState(false);
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
  const picked = chosen === date ? selected : [];
  const selection = picked.filter((key) => !occupied.has(key));
  // Cells someone else took after they were picked, usually the reason a batch failed.
  const taken = picked.filter((key) => occupied.has(key));
  const inspectedReservation = inspected
    ? reservations.find(
        (row) =>
          row.slot === inspected.slot &&
          row.location === inspected.location &&
          occursOn(row, date),
      )
    : undefined;

  function changeSelection(next: (values: string[]) => string[]) {
    setSelected((values) =>
      next(values.filter((value) => !occupied.has(value))),
    );
    setError("");
  }

  async function submit() {
    if (!selection.length || !detail.trim() || busy || past) return;
    setBusy(true);
    setError("");
    try {
      await createUtilityReservations(
        selection.map((key) => ({
          ...parseGongangKey(key),
          profileId: profile.id,
          mode: "gongang",
          reservationDate: date,
          detail: detail.trim(),
          recurring,
        })),
      );
      setSelected([]);
      setDetail("");
      setRecurring(false);
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
          setSelected([]);
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
            changeSelection((values) =>
              toggleGongangKey(values, gongangKey(slot, location), date),
            );
          }}
          onInspect={setInspected}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {taken.length > 0 && (
        <p role="status" className="text-sm text-destructive">
          다른 예약이 등록되어 다음 시간대의 선택을 해제했습니다:{" "}
          {taken
            .map((key) => {
              const { slot, location } = parseGongangKey(key);
              return gongangCellLabel(date, slot, location);
            })
            .join(", ")}
          .{selection.length > 0 && " 나머지 시간대는 예약할 수 있습니다."}
        </p>
      )}
      {selection.length > 0 && !past && (
        <GongangSelectionForm
          date={date}
          selected={selection}
          detail={detail}
          recurring={recurring}
          busy={busy}
          submitLabel={`${selection.length}건 예약`}
          onRemove={(key) =>
            changeSelection((values) => values.filter((value) => value !== key))
          }
          onClear={() => changeSelection(() => [])}
          onDetailChange={setDetail}
          onRecurringChange={setRecurring}
          onSubmit={() => void submit()}
        />
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

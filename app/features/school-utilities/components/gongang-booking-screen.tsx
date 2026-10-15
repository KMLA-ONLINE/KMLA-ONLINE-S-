import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { useAppShell } from "~/features/app-shell";
import { canManageGongang } from "../data/gongang-schedule";
import {
  createUtilityReservations,
  deleteUtilityReservation,
  type UtilityReservation,
} from "../data/reservations";
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
import { UtilityModeTabs } from "./utility-mode-tabs";
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
  const [canManage, setCanManage] = useState(profile.role === "admin");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [inspected, setInspected] = useState<GongangBoardEntry | null>(null);
  const [cancelTarget, setCancelTarget] = useState<UtilityReservation | null>(
    null,
  );
  const { reservations, schedules, loading, loadFailed, refresh } =
    useGongangWeek(week, dates[6]);

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

  const past = date < today;
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

  function changeSelection(next: (values: string[]) => string[]) {
    setSelected(next);
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
      toast.success(`${selection.length}건 신청 완료`);
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
      toast.success("예약을 취소했습니다.");
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
    <div className="mx-auto w-full max-w-2xl space-y-4 px-3 pb-6 sm:px-4 md:px-0">
      <UtilityModeTabs mode="gongang" />
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
      {loadFailed && (
        <GongangLoadError
          message="예약을 불러오지 못했습니다. 다시 시도해주세요."
          onRetry={refresh}
        />
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
          entries={entries}
          readOnly={past}
          selected={selection}
          disabled={busy || loadFailed}
          onSelect={(slot, location) => {
            if (past) return;
            changeSelection((values) =>
              toggleGongangKey(values, gongangKey(slot, location)),
            );
          }}
          onInspect={setInspected}
        />
      </div>
      {past && (
        <p className="text-center text-xs text-muted-foreground">
          지난 날짜입니다.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {selection.length > 0 && !past && (
        <GongangSelectionForm
          date={date}
          selected={selection}
          detail={detail}
          recurring={recurring}
          busy={busy}
          submitLabel={`${selection.length}건 신청`}
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

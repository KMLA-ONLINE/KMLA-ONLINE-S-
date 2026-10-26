import { useRef, useState } from "react";
import { toast } from "sonner";
import { DownloadIcon, PencilIcon, PlusIcon, UploadIcon } from "lucide-react";

import {
  createDonationRound,
  importDonationItems,
  loadDonationClaims,
  type DonationRound,
} from "~/features/donations/data/donations";
import {
  downloadDonationResults,
  parseDonationWorkbook,
  type DonationExportRecord,
  type DonationImportPreview,
} from "~/features/donations/model/workbook";
import { roundPhase } from "~/features/donations/model/round-time";
import {
  DonationRoundManagement,
  readRoundFields,
  RoundFields,
  type RoundFieldValues,
} from "~/features/donations/components/round-management";
import {
  formatDonationDate,
  RoundPhaseBadge,
} from "~/features/donations/components/round-summary";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { getCurrentLocale, translate, useLocale, useT } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { Spinner } from "~/shared/ui/spinner";

const EMPTY_ROUND: RoundFieldValues = { title: "", opensAt: "", closesAt: "" };

const PHASE_LABEL = { open: "진행 중", upcoming: "예정", ended: "종료" };

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : translate(getCurrentLocale(), "처리 중 오류가 발생했습니다.");
}

interface Props {
  rounds: DonationRound[];
  selected: DonationRound | null;
  checkedAt: number;
  itemCount: number;
  itemsLoading: boolean;
  claims: DonationExportRecord[];
  onSelectRound: (id: number) => void;
  /** Reloads rounds, then selects `selectId` when given. */
  onRoundsChanged: (selectId?: number) => Promise<void>;
  onItemsChanged: () => Promise<void>;
}

export function DonationAdminPanel({
  rounds,
  selected,
  checkedAt,
  itemCount,
  itemsLoading,
  claims,
  onSelectRound,
  onRoundsChanged,
  onItemsChanged,
}: Props) {
  const t = useT();
  const locale = useLocale();
  const [creating, setCreating] = useState(rounds.length === 0);
  const [newRound, setNewRound] = useState<RoundFieldValues>(EMPTY_ROUND);
  const [createError, setCreateError] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<DonationImportPreview | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [confirmUpload, setConfirmUpload] = useState(false);

  const phase = selected ? roundPhase(selected, checkedAt) : null;
  const activeClaims = claims.filter(
    (claim) => claim.applied_at !== null && claim.cancelled_at === null,
  ).length;
  const history = claims.filter((claim) => claim.applied_at !== null);

  function resetUpload() {
    setPreview(null);
    setUploadError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleCreate() {
    const next = readRoundFields(newRound);

    setCreateError("");

    if (!next) {
      setCreateError(t("회차 이름과 신청 시작·종료 시간을 확인해 주세요."));
      return;
    }

    setBusy(true);

    try {
      const id = await createDonationRound(
        next.title,
        next.opensAt,
        next.closesAt,
      );
      await onRoundsChanged(id);
      setNewRound(EMPTY_ROUND);
      setCreating(false);
      setEditing(false);
      resetUpload();
      toast.success(t("회차를 만들었습니다. 이제 물품 엑셀을 등록하세요."));
    } catch (e) {
      setCreateError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file?: File) {
    setPreview(null);
    setUploadError("");

    if (!file) return;

    setReading(true);

    try {
      setPreview(await parseDonationWorkbook(file, locale));
    } catch (e) {
      setUploadError(errorMessage(e));
    } finally {
      setReading(false);
    }
  }

  async function handleUpload() {
    if (!selected || !preview) return;

    setBusy(true);

    try {
      const count = await importDonationItems(selected.id, preview.items);
      await onItemsChanged();
      resetUpload();
      toast.success(t("{count}개 물품을 등록했습니다.", { count }));
    } catch (e) {
      setUploadError(errorMessage(e));
    } finally {
      setBusy(false);
      setConfirmUpload(false);
    }
  }

  async function handleDownload() {
    if (!selected) return;

    setBusy(true);

    try {
      const records = await loadDonationClaims(selected.id);
      await downloadDonationResults(records, selected.title);
      toast.success(t("신청 결과 엑셀 파일을 저장했습니다."));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const canUpload = preview?.errors.length === 0 && preview.items.length > 0;

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex items-end gap-2">
          {rounds.length > 0 ? (
            <label className="min-w-0 flex-1 space-y-1 text-sm">
              <span className="text-muted-foreground">{t("회차")}</span>
              <NativeSelect
                className="w-full"
                disabled={busy || reading}
                value={selected?.id ?? ""}
                onChange={(e) => {
                  setEditing(false);
                  resetUpload();
                  onSelectRound(Number(e.currentTarget.value));
                }}
              >
                {rounds.map((round) => (
                  <NativeSelectOption key={round.id} value={round.id}>
                    {round.title} ·{" "}
                    {t(PHASE_LABEL[roundPhase(round, checkedAt)])}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ) : (
            <p className="flex-1 text-sm text-muted-foreground">
              {t("아직 회차가 없습니다. 첫 회차를 만들어 주세요.")}
            </p>
          )}
          <Button
            type="button"
            variant={creating ? "secondary" : "outline"}
            aria-expanded={creating}
            onClick={() => setCreating((open) => !open)}
          >
            <PlusIcon aria-hidden />
            {t("새 회차")}
          </Button>
        </div>

        {creating && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <RoundFields
              values={newRound}
              onChange={setNewRound}
              titlePlaceholder={t("예: 2026년 2학기")}
            />
            {createError && (
              <p role="alert" className="text-sm text-destructive">
                {createError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              {rounds.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setCreating(false)}
                >
                  {t("닫기")}
                </Button>
              )}
              <Button
                type="button"
                disabled={busy}
                onClick={() => void handleCreate()}
              >
                {busy ? <Spinner data-icon="inline-start" /> : null}
                {t("회차 만들기")}
              </Button>
            </div>
          </div>
        )}
      </section>

      {selected && phase && (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold break-words">
                  {selected.title}
                </h2>
                <RoundPhaseBadge phase={phase} />
              </div>
              <p className="text-sm text-muted-foreground">
                {formatDonationDate(selected.opens_at, locale)} ~{" "}
                {formatDonationDate(selected.closes_at, locale)}
              </p>
              <p className="text-sm">
                {t("물품 {count}개 · 신청 {claims}건", {
                  count: itemsLoading ? "…" : itemCount,
                  claims: activeClaims,
                })}
              </p>
            </div>
            {!editing && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditing(true)}
              >
                <PencilIcon aria-hidden />
                {t("수정")}
              </Button>
            )}
          </div>

          {editing && (
            <DonationRoundManagement
              key={selected.id}
              round={selected}
              onSaved={() => onRoundsChanged()}
              onClose={() => setEditing(false)}
            />
          )}

          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={busy || activeClaims === 0}
            onClick={() => void handleDownload()}
          >
            <DownloadIcon aria-hidden />
            {t("신청 결과 엑셀 받기")}
          </Button>
        </section>
      )}

      {selected && phase !== "ended" && !itemsLoading && itemCount === 0 && (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <div>
            <h2 className="font-semibold">{t("물품 엑셀 등록")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "회차마다 한 번만 등록할 수 있습니다. 오류가 하나라도 있으면 등록되지 않으니 안내된 행을 고친 뒤 다시 선택하세요.",
              )}
            </p>
          </div>

          <Input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            aria-label={t("물품 엑셀 파일")}
            disabled={busy || reading}
            onClick={(e) => {
              // Clearing first lets a fixed file with the same name re-parse.
              e.currentTarget.value = "";
            }}
            onChange={(e) => {
              void handleFile(e.currentTarget.files?.[0]);
            }}
          />

          {reading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              {t("엑셀 파일을 검사하는 중입니다.")}
            </p>
          )}

          {uploadError && (
            <p role="alert" className="text-sm text-destructive">
              {uploadError}
            </p>
          )}

          {preview && (
            <div className="space-y-2 text-sm" aria-live="polite">
              <p>
                {t("물품 {count}개", { count: preview.items.length })}
                {preview.errors.length > 0 && (
                  <span className="text-destructive">
                    {" "}
                    {t("· 오류 {count}건", { count: preview.errors.length })}
                  </span>
                )}
              </p>
              {preview.errors.length > 0 && (
                <ul
                  role="alert"
                  className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-destructive/30 p-3 text-destructive"
                >
                  {preview.errors.map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Button
            type="button"
            disabled={busy || reading || !canUpload}
            onClick={() => setConfirmUpload(true)}
          >
            <UploadIcon aria-hidden />
            {t("물품 등록")}
          </Button>
        </section>
      )}

      {history.length > 0 && (
        <details className="group rounded-xl border bg-card">
          <summary className="cursor-pointer list-none p-4 font-semibold">
            {t("신청·취소 이력 {count}건", { count: history.length })}
            <span className="ml-2 text-sm font-normal text-muted-foreground group-open:hidden">
              {t("펼치기")}
            </span>
          </summary>
          <ul className="max-h-80 divide-y overflow-y-auto border-t">
            {history.map((claim) => (
              <li
                key={`${claim.item_id}-${claim.applied_at}`}
                className="px-4 py-2.5 text-sm"
              >
                <p className="break-words">
                  <span className="font-medium">{claim.item_name}</span>
                  {" · "}
                  {claim.applicant_cohort !== null &&
                    `${t("{cohort}기", { cohort: claim.applicant_cohort })} `}
                  {claim.applicant ?? t("알 수 없음")}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("신청 {date}", {
                    date: formatDonationDate(claim.applied_at!, locale),
                  })}
                  {claim.cancelled_at &&
                    ` · ${t("취소 {date}", {
                      date: formatDonationDate(claim.cancelled_at, locale),
                    })}`}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {confirmUpload && preview && (
        <ConfirmDialog
          title={t("물품 등록")}
          description={t(
            "{count}개 물품을 등록합니다. 등록 후에는 이 회차에 다시 업로드할 수 없습니다.",
            { count: preview.items.length },
          )}
          confirmLabel={t("등록")}
          pending={busy}
          onCancel={() => setConfirmUpload(false)}
          onConfirm={() => void handleUpload()}
        />
      )}
    </div>
  );
}

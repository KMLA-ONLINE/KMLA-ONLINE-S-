import { useId, useState } from "react";
import { toast } from "sonner";

import {
  updateDonationRound,
  type DonationRound,
} from "~/features/donations/data/donations";
import {
  seoulInputToIso,
  toSeoulInput,
} from "~/features/donations/model/round-time";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";
import { TextField } from "~/shared/ui/text-field";
import { useT } from "~/shared/i18n";

export interface RoundFieldValues {
  title: string;
  opensAt: string;
  closesAt: string;
}

interface RoundFieldsProps {
  values: RoundFieldValues;
  onChange: (values: RoundFieldValues) => void;
  titlePlaceholder?: string;
}

/** Title and Seoul-time period inputs shared by round creation and editing. */
export function RoundFields({
  values,
  onChange,
  titlePlaceholder,
}: RoundFieldsProps) {
  const t = useT();
  const id = useId();

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="space-y-1 text-sm" htmlFor={`${id}-title`}>
        <span>{t("회차 이름")}</span>
        <TextField
          id={`${id}-title`}
          value={values.title}
          placeholder={titlePlaceholder}
          maxLength={100}
          onChange={(e) =>
            onChange({ ...values, title: e.currentTarget.value })
          }
        />
      </label>

      <label className="space-y-1 text-sm" htmlFor={`${id}-opens`}>
        <span>{t("신청 시작 (한국 시간)")}</span>
        <Input
          id={`${id}-opens`}
          type="datetime-local"
          value={values.opensAt}
          onChange={(e) =>
            onChange({ ...values, opensAt: e.currentTarget.value })
          }
        />
      </label>

      <label className="space-y-1 text-sm" htmlFor={`${id}-closes`}>
        <span>{t("신청 종료 (한국 시간)")}</span>
        <Input
          id={`${id}-closes`}
          type="datetime-local"
          value={values.closesAt}
          onChange={(e) =>
            onChange({ ...values, closesAt: e.currentTarget.value })
          }
        />
      </label>
    </div>
  );
}

/** Returns trimmed title and ISO period, or null when the input is invalid. */
export function readRoundFields(
  values: RoundFieldValues,
  stored?: DonationRound,
): { title: string; opensAt: string; closesAt: string } | null {
  const title = values.title.trim();
  const opensAt = seoulInputToIso(values.opensAt, stored?.opens_at);
  const closesAt = seoulInputToIso(values.closesAt, stored?.closes_at);

  if (!title || !opensAt || !closesAt || opensAt >= closesAt) return null;

  return { title, opensAt, closesAt };
}

interface Props {
  round: DonationRound;
  onSaved: () => Promise<void>;
  onClose: () => void;
}

/** Inline editor for a round's title and Seoul-time period. */
export function DonationRoundManagement({ round, onSaved, onClose }: Props) {
  const t = useT();
  const [values, setValues] = useState<RoundFieldValues>({
    title: round.title,
    opensAt: toSeoulInput(round.opens_at),
    closesAt: toSeoulInput(round.closes_at),
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<NonNullable<
    ReturnType<typeof readRoundFields>
  > | null>(null);

  async function submit(next: NonNullable<ReturnType<typeof readRoundFields>>) {
    setBusy(true);

    try {
      await updateDonationRound(
        round.id,
        next.title,
        next.opensAt,
        next.closesAt,
      );

      await onSaved();
      toast.success(t("회차를 수정했습니다."));
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("수정 중 오류가 발생했습니다."),
      );
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  function save() {
    const next = readRoundFields(values, round);

    setError("");

    if (!next) {
      setError(t("회차 이름과 신청 기간을 확인해 주세요."));
      return;
    }

    const periodChanged =
      Date.parse(next.opensAt) !== Date.parse(round.opens_at) ||
      Date.parse(next.closesAt) !== Date.parse(round.closes_at);
    const started = round.is_open || Date.parse(round.closes_at) <= Date.now();

    if (periodChanged && started) {
      setPending(next);
      return;
    }

    void submit(next);
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <RoundFields values={values} onChange={setValues} />

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("닫기")}
        </Button>
        <Button type="button" disabled={busy} onClick={save}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {t("저장")}
        </Button>
      </div>

      {pending && (
        <ConfirmDialog
          title={t("신청 기간 변경")}
          description={t(
            "이미 시작된 회차입니다. 기간을 바꾸면 학생 신청이 바로 열리거나 닫힐 수 있습니다.",
          )}
          confirmLabel={t("변경")}
          pending={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void submit(pending)}
        />
      )}
    </div>
  );
}

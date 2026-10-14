import { useId, useState } from "react";

import {
  updateDonationRound,
  type DonationRound,
} from "~/features/donations/data/donations";
import {
  seoulInputToIso,
  toSeoulInput,
} from "~/features/donations/model/round-time";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { TextField } from "~/shared/ui/text-field";

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
  const id = useId();

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="space-y-1 text-sm" htmlFor={`${id}-title`}>
        <span>회차 이름</span>
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
        <span>신청 시작 (한국 시간)</span>
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
        <span>신청 종료 (한국 시간)</span>
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
}

export function DonationRoundManagement({ round, onSaved }: Props) {
  const [values, setValues] = useState<RoundFieldValues>({
    title: round.title,
    opensAt: toSeoulInput(round.opens_at),
    closesAt: toSeoulInput(round.closes_at),
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function save() {
    const next = readRoundFields(values, round);

    setError("");
    setNotice("");

    if (!next) {
      setError("회차 이름과 신청 기간을 확인해주세요.");
      return;
    }

    const periodChanged =
      Date.parse(next.opensAt) !== Date.parse(round.opens_at) ||
      Date.parse(next.closesAt) !== Date.parse(round.closes_at);
    const started = round.is_open || Date.parse(round.closes_at) <= Date.now();

    if (
      periodChanged &&
      started &&
      !window.confirm(
        "이미 시작된 회차의 신청 기간을 바꾸면 학생 신청이 즉시 열리거나 닫힐 수 있습니다. 변경할까요?",
      )
    ) {
      return;
    }

    setBusy(true);

    try {
      await updateDonationRound(
        round.id,
        next.title,
        next.opensAt,
        next.closesAt,
      );

      await onSaved();
      setNotice("회차가 수정되었습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "수정 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">회차 수정</h2>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}

      <RoundFields values={values} onChange={setValues} />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            void save();
          }}
        >
          변경사항 저장
        </Button>
      </div>
    </section>
  );
}

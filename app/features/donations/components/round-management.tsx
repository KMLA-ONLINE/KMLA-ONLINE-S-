import { useState } from "react";

import {
  updateDonationRound,
  type DonationRound,
} from "~/features/donations/data/donations";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { TextField } from "~/shared/ui/text-field";

interface Props {
  round: DonationRound;
  onSaved: () => Promise<void>;
}

function toSeoulInput(value: string): string {
  const time = new Date(value).getTime();

  if (!Number.isFinite(time)) return "";

  return new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function toIso(value: string): string | null {
  if (!value) return null;

  const date = new Date(`${value}:00+09:00`);

  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function DonationRoundManagement({ round, onSaved }: Props) {
  const [title, setTitle] = useState(round.title);
  const [opensAt, setOpensAt] = useState(toSeoulInput(round.opens_at));
  const [closesAt, setClosesAt] = useState(toSeoulInput(round.closes_at));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function save() {
    const start = toIso(opensAt);
    const end = toIso(closesAt);

    setError("");
    setNotice("");

    if (!title.trim() || !start || !end || start >= end) {
      setError("회차 이름과 신청 기간을 확인해주세요.");
      return;
    }

    setBusy(true);

    try {
      await updateDonationRound(round.id, title.trim(), start, end);

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

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm" htmlFor="donation-field-108">
          <span>회차 이름</span>
          <TextField
            value={title}
            maxLength={100}
            onChange={(e) => setTitle(e.currentTarget.value)}
            id="donation-field-108"
          />
        </label>

        <label className="space-y-1 text-sm" htmlFor="donation-field-117">
          <span>신청 시작 (한국 시간)</span>
          <Input
            type="datetime-local"
            value={opensAt}
            onChange={(e) => setOpensAt(e.currentTarget.value)}
            id="donation-field-117"
          />
        </label>

        <label className="space-y-1 text-sm" htmlFor="donation-field-126">
          <span>신청 종료 (한국 시간)</span>
          <Input
            type="datetime-local"
            value={closesAt}
            onChange={(e) => setClosesAt(e.currentTarget.value)}
            id="donation-field-126"
          />
        </label>
      </div>

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

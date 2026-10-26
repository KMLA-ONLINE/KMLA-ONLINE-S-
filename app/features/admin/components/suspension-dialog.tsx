import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import type {
  AdminActionResult,
  RosterMember,
} from "~/features/admin/model/types";
import { useT } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";
import { Checkbox } from "~/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";
import { Textarea } from "~/shared/ui/textarea";

/**
 * 이용 정지 또는 해제(§16.11). 둘 다 현재 비밀번호를 받아 전체 인원 route action으로 보낸다.
 * 정지 중인 사람이면 해제, 아니면 정지 양식을 연다. 대상이 바뀌면 호출자가 `key`로 다시 마운트해
 * 입력과 이전 결과를 비운다.
 */
export function SuspensionDialog({
  member,
  onOpenChange,
}: {
  member: RosterMember | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const fetcher = useFetcher<AdminActionResult>();
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("7");
  const [indefinite, setIndefinite] = useState(false);
  const pending = fetcher.state !== "idle";
  const lifting = member?.is_suspended ?? false;

  // 성공하면 닫는다. 목록은 route action 뒤 loader 재검증으로 갱신된다.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onOpenChange(false);
  }, [fetcher.state, fetcher.data, onOpenChange]);

  const changeDays = (value: string) => {
    if (value === "") return setDays("");
    const next = Number(value);
    if (Number.isFinite(next))
      setDays(String(Math.min(180, Math.max(1, Math.trunc(next)))));
  };

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(next) => !next && !pending && onOpenChange(false)}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>
            {lifting ? t("이용 정지를 해제할까요?") : t("이용 정지")}
          </DialogTitle>
          <DialogDescription>
            {lifting
              ? t("{name}님이 바로 다시 앱을 이용할 수 있습니다.", {
                  name: member?.name ?? "",
                })
              : t(
                  "{name}님은 정지 기간 동안 앱을 이용할 수 없습니다. 사유와 해제 예정 시각은 본인에게 공개됩니다.",
                  { name: member?.name ?? "" },
                )}
          </DialogDescription>
        </DialogHeader>

        <fetcher.Form method="post" className="grid gap-4">
          <input
            type="hidden"
            name="intent"
            value={lifting ? "lift" : "suspend"}
          />
          <input type="hidden" name="profileId" value={member?.profile_id} />

          {lifting ? null : (
            <>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="suspension-reason"
                    className="text-sm font-medium"
                  >
                    {t("사유")}
                  </label>
                  <span
                    id="suspension-reason-count"
                    className="text-xs text-muted-foreground tabular-nums"
                  >
                    {Array.from(reason).length}/300
                  </span>
                </div>
                <Textarea
                  id="suspension-reason"
                  name="reason"
                  aria-describedby="suspension-reason-count"
                  value={reason}
                  minLength={5}
                  maxLength={300}
                  required
                  rows={4}
                  placeholder={t("정지 사유를 입력하세요.")}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <label
                  htmlFor="suspension-days"
                  className="grid gap-1.5 text-sm font-medium"
                >
                  {t("기간(일)")}
                  <Input
                    id="suspension-days"
                    name="days"
                    type="number"
                    value={days}
                    min={1}
                    max={180}
                    step={1}
                    required={!indefinite}
                    disabled={indefinite}
                    onChange={(event) => changeDays(event.target.value)}
                    onBlur={() => days === "" && setDays("7")}
                  />
                </label>
                <div className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id="suspension-indefinite"
                    checked={indefinite}
                    onCheckedChange={(checked) => setIndefinite(checked)}
                  />
                  <label htmlFor="suspension-indefinite">{t("무기한")}</label>
                </div>
                {indefinite ? (
                  <input type="hidden" name="indefinite" value="on" />
                ) : null}
              </div>
            </>
          )}

          <label
            htmlFor="suspension-password"
            className="grid gap-1.5 text-sm font-medium"
          >
            {t("현재 비밀번호")}
            <Input
              id="suspension-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>

          {fetcher.data?.error && !pending ? (
            <p role="alert" className="text-sm text-destructive">
              {fetcher.data.error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {t("취소")}
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {lifting ? t("정지 해제") : t("정지")}
            </Button>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}

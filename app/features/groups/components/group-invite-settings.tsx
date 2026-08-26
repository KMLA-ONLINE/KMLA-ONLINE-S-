import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { useFetcher } from "react-router";

import type { GroupDetail, GroupInvite } from "~/features/groups/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { Button } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { TextField } from "~/shared/ui/text-field";
import { Spinner } from "~/shared/ui/spinner";

/** 시간 단위. 기본이 하루인 것은 의도다 — 더 오래 열어 두려면 한 번 골라야 한다. */
const LIFETIME_OPTIONS: [number, string][] = [
  [1, "1시간"],
  [12, "12시간"],
  [24, "1일"],
  [168, "7일"],
  [336, "14일"],
];

/**
 * 그룹 초대 링크.
 *
 * 링크는 그룹당 하나만 살아 있다. 여러 개를 두면 목록 화면과 개별 취소가 따라붙는데, 그만한
 * 이득이 없다 — 채널을 나눠 추적할 일이 없는 규모다. 대신 재발급이 곧 이전 링크의 무효화가
 * 되므로 "끊고 싶다"와 "다시 만들고 싶다"가 갈린다. 그래서 취소 버튼을 따로 둔다.
 */
export function InviteSettings({
  group,
  invite,
}: {
  group: GroupDetail;
  invite: GroupInvite | null;
}) {
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const [hours, setHours] = useState(24);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<"reissue" | "revoke" | null>(
    null,
  );
  const pending = fetcher.state !== "idle";

  // 공식 그룹에는 초대할 사람이 없다. 승인된 재학생은 트리거로 자동 가입한다.
  if (group.kind === "official") return null;
  if (group.member_role !== "owner" && group.member_role !== "admin") {
    return null;
  }

  const issue = () => {
    setConfirming(null);
    setCopied(false);
    void fetcher.submit(
      {
        intent: "issue-invite",
        groupId: group.group_id,
        hours: String(hours),
      },
      { method: "post" },
    );
  };

  const revoke = () => {
    setConfirming(null);
    setCopied(false);
    void fetcher.submit(
      { intent: "revoke-invite", groupId: group.group_id },
      { method: "post" },
    );
  };

  const copy = async () => {
    if (!invite) return;
    await navigator.clipboard?.writeText(inviteUrl(invite.token));
    setCopied(true);
  };

  return (
    <Card className="rounded-none border-x-0 md:rounded-xl md:border">
      <CardHeader className="border-b">
        <CardTitle>초대 링크</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm leading-6 text-muted-foreground">
          링크를 받은 사람은 승인 없이 바로 멤버가 됩니다.
        </p>

        {invite ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <TextField
                readOnly
                value={inviteUrl(invite.token)}
                aria-label="초대 링크"
                className="font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => void copy()}
              >
                {copied ? (
                  <CheckIcon data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <CopyIcon data-icon="inline-start" aria-hidden="true" />
                )}
                {copied ? "복사함" : "복사"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatExpiry(invite.expires_at)}에 만료됩니다.
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="grid flex-1 gap-1.5 text-sm font-medium">
            유효 기간
            <NativeSelect
              aria-label="유효 기간"
              value={hours}
              disabled={pending}
              className="w-full [&_[data-slot=native-select]]:h-10 [&_[data-slot=native-select]]:rounded-lg"
              onChange={(event) => setHours(Number(event.currentTarget.value))}
            >
              {LIFETIME_OPTIONS.map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <Button
            type="button"
            variant={invite ? "outline" : "default"}
            className="shrink-0"
            disabled={pending}
            onClick={() => (invite ? setConfirming("reissue") : issue())}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {invite ? "새 링크 만들기" : "초대 링크 만들기"}
          </Button>
          {invite ? (
            <Button
              type="button"
              variant="ghost"
              className="shrink-0 text-destructive hover:text-destructive"
              disabled={pending}
              onClick={() => setConfirming("revoke")}
            >
              링크 끊기
            </Button>
          ) : null}
        </div>

        {fetcher.data?.error ? (
          <p role="alert" className="text-sm text-destructive">
            {fetcher.data.error}
          </p>
        ) : null}
      </CardContent>

      {confirming === "reissue" ? (
        <ConfirmDialog
          title="새 초대 링크"
          description="지금 링크는 즉시 끊깁니다. 이미 링크를 받은 사람도 더 이상 들어올 수 없습니다."
          confirmLabel="새 링크 만들기"
          pending={pending}
          onCancel={() => setConfirming(null)}
          onConfirm={issue}
        />
      ) : null}

      {confirming === "revoke" ? (
        <ConfirmDialog
          title="초대 링크 끊기"
          description="이미 가입한 멤버는 그대로 남습니다."
          confirmLabel="링크 끊기"
          destructive
          pending={pending}
          onCancel={() => setConfirming(null)}
          onConfirm={revoke}
        />
      ) : null}
    </Card>
  );
}

function inviteUrl(token: string): string {
  return `${window.location.origin}/invite/${token}`;
}

function formatExpiry(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useRevalidator } from "react-router";

import type { StorageCleanupStatus } from "~/features/admin/model/types";
import { RelativeTime } from "~/shared/components/relative-time";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/shared/ui/card";
import { Spinner } from "~/shared/ui/spinner";

/**
 * 정리 상태를 화면에 올리는 이유는 통계가 아니라 침묵을 막기 위해서다. 예전 정리 작업은 Vault 시크릿이 없으면 아무것도 안 하고 성공으로 기록했다.
 * `secrets_configured`와 마지막 실행 결과를 나란히 두고, 라벨·보조 설명이 각 숫자의 뜻을, 맨 위 판정이 "지금 괜찮은가"를 답한다.
 */
export function StorageCleanupScreen({
  status,
}: {
  status: StorageCleanupStatus | null;
}) {
  const revalidator = useRevalidator();
  const refreshing = revalidator.state === "loading";

  if (!status) {
    return (
      <div className="px-4 py-6">
        <p className="text-sm text-muted-foreground">
          정리 상태를 불러오지 못했습니다.
        </p>
      </div>
    );
  }

  const health = summarize(status);

  return (
    <div className="space-y-6 px-0 py-4 md:px-4">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 md:px-0">
        <p className="max-w-prose text-sm text-muted-foreground">
          쓰이지 않는 첨부·이미지 파일을 워커가 지웁니다. 상태만 보는
          화면입니다.
        </p>
        <div className="flex flex-col items-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={() => void revalidator.revalidate()}
          >
            {refreshing ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            상태 새로고침
          </Button>
          <p className="sr-only" aria-live="polite">
            {refreshing ? "정리 상태를 새로고치는 중입니다." : ""}
          </p>
        </div>
      </div>

      {/* 판정이 뒤집히는 순간을 낭독하려고 영역을 마운트 때부터 둔다. `role="alert"`는 과해서 쓰지 않는다. */}
      <Card className="rounded-none md:rounded-xl" aria-live="polite">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HealthIcon tone={health.tone} />
            {health.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p className="max-w-prose break-words text-muted-foreground">
            {health.detail}
          </p>
        </CardContent>
      </Card>

      <Card className="rounded-none md:rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HealthIcon tone={status.secrets_configured ? "ok" : "down"} />
            워커 설정
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {status.secrets_configured ? (
            <p className="break-words text-muted-foreground">
              <code>project_url</code>과 <code>storage_cleanup_secret</code>{" "}
              모두 있음
            </p>
          ) : (
            <p role="alert" className="break-words text-destructive">
              <code>project_url</code>과 <code>storage_cleanup_secret</code>을
              Vault에 설정해 주세요.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-none md:rounded-xl">
        <CardHeader>
          <CardTitle>삭제 대기 파일</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric
              label="대기 중"
              value={status.queue_pending}
              hint="재시도 포함"
            />
            <Metric
              label="그중 재시도"
              value={status.queue_retrying}
              warn={status.queue_retrying > 0}
            />
            <Metric
              label="스윕 후보"
              value={status.queue_dry_run}
              hint="지우지 않음"
            />
            <Field label="가장 오래된 대기">
              {status.queue_oldest_enqueued_at ? (
                <RelativeTime value={status.queue_oldest_enqueued_at} />
              ) : (
                "없음"
              )}
            </Field>
          </dl>
        </CardContent>
      </Card>

      <Card className="rounded-none md:rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            마지막 실행
            <LastRunBadge status={status} />
          </CardTitle>
          <CardDescription>최근 실행 한 번의 결과입니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="시작">
              {status.last_run_started_at ? (
                <RelativeTime value={status.last_run_started_at} />
              ) : (
                "-"
              )}
            </Field>
            <Field label="응답 코드" numeric>
              {status.last_run_status_code ?? "-"}
            </Field>
            <Field label="삭제한 파일" numeric hint="이미 없던 파일 포함">
              {status.last_run_removed ?? "-"}
            </Field>
            <Field label="못 지운 파일" numeric>
              {status.last_run_failed ?? "-"}
            </Field>
          </dl>
          {status.last_run_error ? (
            <p role="alert" className="break-words text-destructive">
              {status.last_run_error}
            </p>
          ) : null}
          <p className="break-words text-muted-foreground">
            예약 실행:{" "}
            {status.last_cron_at ? (
              <>
                <RelativeTime value={status.last_cron_at} />
                {status.last_cron_status ? ` · ${status.last_cron_status}` : ""}
              </>
            ) : (
              "기록 없음"
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

type HealthTone = "ok" | "warn" | "down";

/**
 * 카드 넷을 다 읽어야 알 수 있던 "지금 괜찮은가"를 한 줄로 앞세운다. 판정은 화면에 이미 있는
 * 값에서만 나온다 — 여기에서 새 임계값을 만들면 화면이 스스로를 설명하지 못한다.
 */
function summarize(status: StorageCleanupStatus): {
  tone: HealthTone;
  title: string;
  detail: string;
} {
  if (!status.secrets_configured) {
    return {
      tone: "down",
      title: "정리가 멈춰 있습니다",
      detail: "Vault 시크릿이 없어 워커를 부르지 못합니다.",
    };
  }

  // 실행 기록 유무를 먼저 가른다. 돌지 않은 실행은 실패할 수도 없다. `LastRunBadge`와 같은 순서로 물어 두 판정이 어긋나지 않게 한다.
  if (status.last_run_started_at === null) {
    return status.queue_pending > 0
      ? {
          tone: "warn",
          title: "아직 한 번도 실행되지 않았습니다",
          detail: `대기 파일 ${status.queue_pending}개가 실행을 기다리고 있습니다.`,
        }
      : {
          tone: "ok",
          title: "지울 파일이 없습니다",
          detail: "대기 파일도 실행 기록도 없습니다.",
        };
  }

  if (runFailed(status)) {
    return {
      tone: "warn",
      title: "마지막 실행이 실패했습니다",
      detail: "대기 파일은 큐에 남아 다시 시도합니다.",
    };
  }

  if (status.last_run_finished_at === null) {
    return {
      tone: "ok",
      title: "정리가 실행 중입니다",
      detail: "워커 응답을 기다리고 있습니다.",
    };
  }

  if (status.last_run_failed !== null && status.last_run_failed > 0) {
    return {
      tone: "warn",
      title: "일부 파일을 지우지 못했습니다",
      detail: `요청은 성공했지만 ${status.last_run_failed}개가 남아 다시 시도합니다.`,
    };
  }

  return {
    tone: "ok",
    title: "정상 동작 중입니다",
    detail:
      status.queue_pending > 0
        ? `${status.queue_pending}개가 다음 차례를 기다립니다.`
        : "대기 중인 파일이 없습니다.",
  };
}

/** 오류 메시지나 4xx·5xx 응답. 개별 파일 실패(`last_run_failed`)와는 층이 다르다. */
function runFailed(status: StorageCleanupStatus): boolean {
  return (
    status.last_run_error !== null ||
    (status.last_run_status_code !== null && status.last_run_status_code >= 400)
  );
}

/** 판정 배너와 큐 지표가 같은 "주의"를 같은 색으로 말하도록 한곳에 둔다. */
const TONE_TEXT: Record<HealthTone, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  down: "text-destructive",
};

function HealthIcon({ tone }: { tone: HealthTone }) {
  const Icon = tone === "ok" ? CheckCircle2Icon : AlertTriangleIcon;
  return <Icon className={`size-5 ${TONE_TEXT[tone]}`} aria-hidden />;
}

/** `dd` 안에 두는 보조 설명. `dl > div`는 `dt`/`dd` 묶음만 담을 수 있어 형제 `p`는 무효다. */
function Hint({ children }: { children: string }) {
  return (
    <span className="block text-xs font-normal text-muted-foreground">
      {children}
    </span>
  );
}

function LastRunBadge({ status }: { status: StorageCleanupStatus }) {
  if (status.last_run_started_at === null) {
    return <Badge variant="secondary">기록 없음</Badge>;
  }
  if (runFailed(status)) {
    return <Badge variant="destructive">실패</Badge>;
  }
  if (status.last_run_finished_at === null) {
    return (
      <Badge variant="secondary">
        <CircleDashedIcon aria-hidden />
        진행 중
      </Badge>
    );
  }
  // 요청은 200인데 개별 파일이 남은 경우. "성공" 옆에 못 지운 파일 수가 서 있으면 어느 쪽을
  // 믿어야 할지 알 수 없으므로 배지가 먼저 말한다.
  if (status.last_run_failed !== null && status.last_run_failed > 0) {
    return <Badge variant="destructive">부분 실패</Badge>;
  }
  return <Badge variant="secondary">성공</Badge>;
}

function Metric({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: number | null;
  hint?: string;
  warn?: boolean;
}) {
  // 재시도는 실패가 아니라 주의다. 판정 배너의 warn과 같은 색을 쓴다.
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1">
        <span
          className={`text-2xl font-semibold tabular-nums ${warn ? TONE_TEXT.warn : ""}`}
        >
          {value ?? 0}
        </span>
        {hint ? <Hint>{hint}</Hint> : null}
      </dd>
    </div>
  );
}

function Field({
  label,
  children,
  hint,
  numeric,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  numeric?: boolean;
}) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1">
        <span className={`font-medium ${numeric ? "tabular-nums" : ""}`}>
          {children}
        </span>
        {hint ? <Hint>{hint}</Hint> : null}
      </dd>
    </div>
  );
}

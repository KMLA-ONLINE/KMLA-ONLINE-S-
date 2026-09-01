import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
} from "lucide-react";

import type { StorageCleanupStatus } from "~/features/admin/model/types";
import { RelativeTime } from "~/shared/components/relative-time";
import { Badge } from "~/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";

/**
 * 정리 상태를 화면에 올리는 이유는 통계가 아니라 침묵을 막기 위해서다. 예전 정리 작업은 Vault
 * 시크릿이 없으면 아무 일도 하지 않고 성공으로 기록해서, 한 번도 돌지 않았다는 사실을 어디에서도
 * 확인할 수 없었다. `secrets_configured`와 마지막 실행 결과를 나란히 두는 것이 이 화면의 본체다.
 */
export function StorageCleanupScreen({
  status,
}: {
  status: StorageCleanupStatus | null;
}) {
  if (!status) {
    return (
      <div className="px-4 py-6">
        <p className="text-sm text-muted-foreground">
          정리 상태를 불러오지 못했습니다.
        </p>
      </div>
    );
  }

  const configured = status.secrets_configured;
  const lastRunFailed =
    status.last_run_error !== null ||
    (status.last_run_status_code !== null &&
      status.last_run_status_code >= 400);

  return (
    <div className="space-y-6 px-0 py-4 md:px-4">
      <Card className="rounded-none md:rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {configured ? (
              <CheckCircle2Icon
                className="size-5 text-emerald-600"
                aria-hidden
              />
            ) : (
              <AlertTriangleIcon
                className="size-5 text-destructive"
                aria-hidden
              />
            )}
            워커 설정
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {configured ? (
            <p className="text-muted-foreground">
              Vault에 <code>project_url</code>과{" "}
              <code>storage_cleanup_secret</code>이 모두 있습니다.
            </p>
          ) : (
            <p role="alert" className="text-destructive">
              Vault 시크릿이 없어 정리 작업이 실행되지 않습니다.{" "}
              <code>project_url</code>과 <code>storage_cleanup_secret</code>을
              이 프로젝트에 설정해 주세요.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-none md:rounded-xl">
        <CardHeader>
          <CardTitle>삭제 대기</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Metric label="대기" value={status.queue_pending} />
          <Metric
            label="재시도 중"
            value={status.queue_retrying}
            warn={status.queue_retrying > 0}
          />
          <Metric
            label="스윕 후보"
            value={status.queue_dry_run}
            hint="dry-run이라 아직 지우지 않음"
          />
          <div>
            <p className="text-muted-foreground">가장 오래된 대기</p>
            <p className="mt-1 font-medium">
              {status.queue_oldest_enqueued_at ? (
                <RelativeTime value={status.queue_oldest_enqueued_at} />
              ) : (
                "없음"
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-none md:rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            마지막 실행
            {status.last_run_started_at === null ? (
              <Badge variant="secondary">기록 없음</Badge>
            ) : lastRunFailed ? (
              <Badge variant="destructive">실패</Badge>
            ) : status.last_run_finished_at === null ? (
              <Badge variant="secondary">
                <CircleDashedIcon aria-hidden />
                진행 중
              </Badge>
            ) : (
              <Badge variant="secondary">성공</Badge>
            )}
          </CardTitle>
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
            <Field label="응답 코드">
              {status.last_run_status_code ?? "-"}
            </Field>
            <Field label="삭제">{status.last_run_removed ?? "-"}</Field>
            <Field label="실패">{status.last_run_failed ?? "-"}</Field>
          </dl>
          {status.last_run_error ? (
            <p role="alert" className="text-destructive">
              {status.last_run_error}
            </p>
          ) : null}
          <p className="text-muted-foreground">
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
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${warn ? "text-destructive" : ""}`}
      >
        {value ?? 0}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{children}</dd>
    </div>
  );
}

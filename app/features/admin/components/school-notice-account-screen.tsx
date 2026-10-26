import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  RefreshCwIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { useFetcher, useRevalidator } from "react-router";

import type {
  AdminActionResult,
  SchoolNoticeStatus,
} from "~/features/admin/model/types";
import { RelativeTime } from "~/shared/components/relative-time";
import { useClientNow } from "~/shared/hooks/use-client-now";
import { useT, type Translate } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/shared/ui/card";
import { Field, FieldDescription, FieldLabel } from "~/shared/ui/field";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";
import { TextField } from "~/shared/ui/text-field";

/** 함수가 이 시간 안에 결과를 기록하지 않으면 요청이 함수까지 닿지 못한 것으로 본다. */
const NO_RESPONSE_AFTER_MS = 5 * 60 * 1000;

const SYNC_ERRORS: Record<string, string> = {
  missing_credentials: "학교 계정이 설정되지 않았습니다.",
  empty_list:
    "공지 목록을 끝까지 읽지 못했습니다. 학교 아이디·비밀번호가 맞는지 확인해 주세요.",
  detail_unreadable:
    "공지 본문을 읽지 못했습니다. 도중에 학교 로그인이 풀렸을 수 있어 다음 동기화 때 다시 시도합니다.",
  school_unreachable: "학교 서버에 연결하지 못했습니다.",
  school_timeout: "학교 서버가 제때 응답하지 않았습니다.",
};

function describeSyncError(code: string, t: Translate): string {
  if (code.startsWith("school_http_")) {
    return t("학교 서버가 오류({status})를 돌려줬습니다.", {
      status: code.slice("school_http_".length),
    });
  }
  const known = SYNC_ERRORS[code];
  return known ? t(known) : code;
}

/**
 * 학교 공지 동기화에 쓰는 학교 계정을 바꾸고 동기화 상태를 본다. 학교 아이디는 누구 계정인지
 * 알 수 있게 보여주고, 비밀번호는 입력만 받는다 — 서버도 저장한 비밀번호를 돌려주지 않는다.
 */
export function SchoolNoticeAccountScreen({
  status,
}: {
  status: SchoolNoticeStatus | null;
}) {
  const t = useT();
  const revalidator = useRevalidator();
  const refreshing = revalidator.state === "loading";
  const save = useFetcher<AdminActionResult>();
  const sync = useFetcher<AdminActionResult>();
  const saving = save.state !== "idle";
  const syncing = sync.state !== "idle";
  const now = useClientNow();
  const saveForm = useRef<HTMLFormElement>(null);

  // 저장에 성공했을 때만 비밀번호를 지운다. 실패하면 고쳐서 다시 보낼 수 있게 입력을 남긴다.
  useEffect(() => {
    if (save.state === "idle" && save.data?.ok) saveForm.current?.reset();
  }, [save.state, save.data]);

  if (!status) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        {t("동기화 상태를 불러오지 못했습니다.")}
      </p>
    );
  }

  const failedLast =
    status.last_error_at !== null &&
    (status.last_success_at === null ||
      status.last_error_at > status.last_success_at);
  const noResponse =
    status.last_requested_at !== null &&
    (status.last_attempt_at === null ||
      status.last_attempt_at < status.last_requested_at) &&
    now - new Date(status.last_requested_at).getTime() > NO_RESPONSE_AFTER_MS;
  const healthy =
    status.sync_configured &&
    status.account_configured &&
    !failedLast &&
    !noResponse &&
    status.last_success_at !== null;

  return (
    <div className="space-y-6 px-0 py-4 md:px-4">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 md:px-0">
        <p className="max-w-prose text-sm text-muted-foreground">
          {t(
            "학교 계정으로 인트라넷에 로그인해 최신 공지 30건을 30분마다 가져옵니다.",
          )}
        </p>
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
          {t("상태 새로고침")}
        </Button>
      </div>

      <Card className="rounded-none md:rounded-xl" aria-live="polite">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {healthy ? (
              <CheckCircle2Icon
                className="size-5 text-emerald-600 dark:text-emerald-400"
                aria-hidden
              />
            ) : (
              <AlertTriangleIcon
                className="size-5 text-amber-600 dark:text-amber-400"
                aria-hidden
              />
            )}
            {t(
              !status.sync_configured
                ? "동기화 설정이 없습니다"
                : !status.account_configured
                  ? "학교 계정을 입력해 주세요"
                  : noResponse
                    ? "동기화 요청에 응답이 없습니다"
                    : failedLast
                      ? "마지막 동기화가 실패했습니다"
                      : status.last_success_at === null
                        ? "아직 동기화하지 않았습니다"
                        : "정상 동작 중입니다",
            )}
          </CardTitle>
          {!status.sync_configured ? (
            <CardDescription>
              {t("Vault에 {a}과 {b}을 설정해 주세요.", {
                a: "project_url",
                b: "school_notice_sync_secret",
              })}
            </CardDescription>
          ) : noResponse ? (
            <CardDescription>
              {t("{fn} 함수 배포와 함수 시크릿을 확인해 주세요.", {
                fn: "sync-school-notices",
              })}
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Item label={t("학교 아이디")}>{status.login_id ?? t("없음")}</Item>
            <Item label={t("마지막 성공")}>
              {status.last_success_at ? (
                <RelativeTime value={status.last_success_at} />
              ) : (
                "-"
              )}
            </Item>
            <Item label={t("보관 중인 공지")}>
              {t("{count}건", { count: status.notice_count })}
            </Item>
          </dl>
          {failedLast && status.last_error && status.last_error_at ? (
            <p role="alert" className="break-words text-destructive">
              <RelativeTime value={status.last_error_at} /> ·{" "}
              {describeSyncError(status.last_error, t)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <sync.Form method="post">
              <input type="hidden" name="intent" value="sync" />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={syncing || !status.sync_configured}
              >
                {syncing ? <Spinner data-icon="inline-start" /> : null}
                {t("지금 동기화")}
              </Button>
            </sync.Form>
            <ActionMessage
              result={syncing ? undefined : sync.data}
              success={t(
                "동기화를 요청했습니다. 잠시 뒤 상태를 새로고침해 주세요.",
              )}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-none md:rounded-xl">
        <CardHeader>
          <CardTitle>{t("학교 계정 바꾸기")}</CardTitle>
          <CardDescription>
            {t(
              "학교가 허락한 공지 열람용 계정을 넣어 주세요. 저장하면 바로 한 번 동기화합니다.",
            )}
            {status.account_updated_at ? (
              <>
                {" "}
                {t("마지막 변경:")}{" "}
                <RelativeTime value={status.account_updated_at} />
              </>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <save.Form ref={saveForm} method="post" className="space-y-4">
            <input type="hidden" name="intent" value="save" />
            <Field>
              <FieldLabel htmlFor="school-login-id">
                {t("학교 아이디")}
              </FieldLabel>
              <TextField
                id="school-login-id"
                name="login_id"
                required
                defaultValue={status.login_id ?? ""}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="school-password">
                {t("학교 비밀번호")}
              </FieldLabel>
              <Input
                id="school-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
              />
              <FieldDescription>
                {t("저장한 비밀번호는 다시 볼 수 없습니다.")}
              </FieldDescription>
            </Field>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <ActionMessage
                result={saving ? undefined : save.data}
                success={t(
                  "저장했습니다. 잠시 뒤 상태를 새로고침해 결과를 확인해 주세요.",
                )}
              />
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner data-icon="inline-start" /> : null}
                {t("저장")}
              </Button>
            </div>
          </save.Form>
        </CardContent>
      </Card>
    </div>
  );
}

function ActionMessage({
  result,
  success,
}: {
  result: AdminActionResult | undefined;
  success: string;
}) {
  if (result?.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {result.error}
      </p>
    );
  }
  if (result?.ok) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {success}
      </p>
    );
  }
  return null;
}

function Item({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium break-all">{children}</dd>
    </div>
  );
}

import { Link, useFetcher } from "react-router";

import type { GroupJoinRequest } from "~/features/groups/model/types";
import { formatCohort } from "~/features/profiles";
import { UserAvatar } from "~/shared/components/user-avatar";
import { useLocale, useT, type Locale } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";

export function GroupJoinRequestsPanel({
  groupId,
  requests,
}: {
  groupId: string;
  requests: GroupJoinRequest[];
}) {
  const t = useT();
  const locale = useLocale();
  const fetcher = useFetcher<{ error?: string }>();
  const pending = fetcher.state !== "idle";

  if (requests.length === 0) return null;

  return (
    <Card className="rounded-none border-x-0 md:rounded-xl md:border">
      <CardHeader>
        <CardTitle>
          {t("가입 요청 {count}", { count: requests.length })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {requests.map((request) => (
            <li
              key={request.request_id}
              className="flex min-h-16 items-center gap-3 py-2"
            >
              <UserAvatar
                src={request.avatar_url}
                name={request.name}
                size="lg"
              />
              <div className="min-w-0 flex-1">
                <Link
                  to={`/profile/${request.pub_id}`}
                  className="font-medium hover:underline"
                >
                  {request.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {formatCohort(request.cohort, request.is_returning_student) ??
                    t("기수 없음")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("{date} 요청", {
                    date: formatDate(request.requested_at, locale),
                  })}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    void fetcher.submit(
                      {
                        intent: "approve-join-request",
                        groupId,
                        requestId: request.request_id,
                      },
                      { method: "post" },
                    )
                  }
                >
                  {t("승인")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    void fetcher.submit(
                      {
                        intent: "reject-join-request",
                        groupId,
                        requestId: request.request_id,
                      },
                      { method: "post" },
                    )
                  }
                >
                  {t("거절")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {fetcher.data?.error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {fetcher.data.error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// 포매터 생성이 포매팅보다 훨씬 비싸서 언어별로 하나씩 둔다.
const DATE_FORMAT: Record<Locale, Intl.DateTimeFormat> = {
  ko: new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }),
  en: new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }),
};

function formatDate(value: string, locale: Locale): string {
  return DATE_FORMAT[locale].format(new Date(value));
}

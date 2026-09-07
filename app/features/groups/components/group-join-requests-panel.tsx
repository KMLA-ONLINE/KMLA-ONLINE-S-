import { Link, useFetcher } from "react-router";

import type { GroupJoinRequest } from "~/features/groups/model/types";
import { formatCohort } from "~/features/profiles";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Button } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";

export function GroupJoinRequestsPanel({
  groupId,
  requests,
}: {
  groupId: string;
  requests: GroupJoinRequest[];
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const pending = fetcher.state !== "idle";

  if (requests.length === 0) return null;

  return (
    <Card className="rounded-none border-x-0 md:rounded-xl md:border">
      <CardHeader>
        <CardTitle>
          가입 요청 {requests.length.toLocaleString("ko-KR")}
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
                src={request.avatar_path}
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
                    "기수 없음"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(request.requested_at)} 요청
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
                  승인
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
                  거절
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

import { useState } from "react";
import { useFetcher } from "react-router";

import {
  AdminPersonRow,
  AdminSearch,
} from "~/features/admin/components/member-list";
import type {
  AcceptedUser,
  AdminActionResult,
} from "~/features/admin/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";

export function GongangManagersScreen({
  managers,
  candidates,
  query,
}: {
  managers: AcceptedUser[];
  candidates: AcceptedUser[];
  query: string;
}) {
  const fetcher = useFetcher<AdminActionResult>();
  const [target, setTarget] = useState<AcceptedUser | null>(null);
  const busy = fetcher.state !== "idle";
  const submit = () => {
    if (!target) return;
    void fetcher.submit(
      {
        intent: "set-manager",
        profileId: String(target.profile_id),
        enabled: String(!target.has_gongang_manage),
      },
      { method: "post" },
    );
    setTarget(null);
  };
  return (
    <div className="space-y-6 px-0 py-4 md:px-4">
      <MemberCard
        title={`현재 관리자 ${managers.length}명`}
        people={managers}
        empty="현재 공강 관리자가 없습니다."
        action={(person) => (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setTarget(person)}
          >
            권한 회수
          </Button>
        )}
      />
      <Card className="rounded-none md:rounded-xl">
        <CardHeader>
          <CardTitle>관리자 후보 검색</CardTitle>
          <AdminSearch query={query} label="공강 관리자 후보 검색" />
        </CardHeader>
        <CardContent className="px-0">
          <ul>
            {candidates.map((person) => (
              <AdminPersonRow
                key={person.profile_id}
                person={person}
                status={
                  person.has_gongang_manage ? (
                    <Badge variant="secondary">관리 중</Badge>
                  ) : null
                }
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={person.has_gongang_manage}
                    onClick={() => setTarget(person)}
                  >
                    권한 부여
                  </Button>
                }
              />
            ))}
          </ul>
          {query && !candidates.length ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              검색 결과가 없습니다.
            </p>
          ) : null}
          {!query ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              두 글자 이상 입력해 검색하세요.
            </p>
          ) : null}
        </CardContent>
      </Card>
      {fetcher.data?.error ? (
        <p role="alert" className="px-4 text-sm text-destructive md:px-0">
          {fetcher.data.error}
        </p>
      ) : null}
      {target ? (
        <ConfirmDialog
          title={
            target.has_gongang_manage
              ? "공강 관리 권한 회수"
              : "공강 관리 권한 부여"
          }
          description={`${target.name}(@${target.pub_id})님의 공강 관리 권한을 ${target.has_gongang_manage ? "회수" : "부여"}합니다.`}
          confirmLabel={target.has_gongang_manage ? "회수" : "부여"}
          destructive={target.has_gongang_manage}
          pending={busy}
          onCancel={() => setTarget(null)}
          onConfirm={submit}
        />
      ) : null}
    </div>
  );
}

function MemberCard({
  title,
  people,
  empty,
  action,
}: {
  title: string;
  people: AcceptedUser[];
  empty: string;
  action: (person: AcceptedUser) => React.ReactNode;
}) {
  return (
    <Card className="rounded-none md:rounded-xl">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {people.length ? (
          <ul>
            {people.map((person) => (
              <AdminPersonRow
                key={person.profile_id}
                person={person}
                status={<Badge variant="secondary">공강 관리자</Badge>}
                action={action(person)}
              />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {empty}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

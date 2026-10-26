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
import { useT } from "~/shared/i18n";
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
  const t = useT();
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
        title={t("현재 관리자 {count}명", { count: managers.length })}
        people={managers}
        empty={t("현재 공강 관리자가 없습니다.")}
        action={(person) => (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setTarget(person)}
          >
            {t("권한 회수")}
          </Button>
        )}
      />
      <Card className="rounded-none md:rounded-xl">
        <CardHeader>
          <CardTitle>{t("관리자 후보 검색")}</CardTitle>
          <AdminSearch query={query} label={t("공강 관리자 후보 검색")} />
        </CardHeader>
        <CardContent className="px-0">
          <ul>
            {candidates.map((person) => (
              <AdminPersonRow
                key={person.profile_id}
                person={person}
                status={
                  person.has_gongang_manage ? (
                    <Badge variant="secondary">{t("관리 중")}</Badge>
                  ) : null
                }
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={person.has_gongang_manage}
                    onClick={() => setTarget(person)}
                  >
                    {t("권한 부여")}
                  </Button>
                }
              />
            ))}
          </ul>
          {query && !candidates.length ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("검색 결과가 없습니다.")}
            </p>
          ) : null}
          {!query ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("두 글자 이상 입력해 검색하세요.")}
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
              ? t("공강 관리 권한 회수")
              : t("공강 관리 권한 부여")
          }
          description={t(
            target.has_gongang_manage
              ? "{name}(@{pubId})님의 공강 관리 권한을 회수합니다."
              : "{name}(@{pubId})님의 공강 관리 권한을 부여합니다.",
            { name: target.name, pubId: target.pub_id },
          )}
          confirmLabel={target.has_gongang_manage ? t("회수") : t("부여")}
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
  const t = useT();
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
                status={<Badge variant="secondary">{t("공강 관리자")}</Badge>}
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

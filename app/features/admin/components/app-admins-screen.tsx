import { useState } from "react";
import { useFetcher } from "react-router";

import {
  AdminPersonRow,
  AdminSearch,
} from "~/features/admin/components/member-list";
import type {
  AdminActionResult,
  AdminMember,
} from "~/features/admin/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";
import { Input } from "~/shared/ui/input";
import { Label } from "~/shared/ui/label";

export function AdminReauthentication() {
  const fetcher = useFetcher<AdminActionResult>();
  const busy = fetcher.state !== "idle";
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>비밀번호 확인</CardTitle>
          <p className="text-sm text-muted-foreground">
            관리자 명단은 민감한 정보입니다. 현재 계정의 비밀번호를 다시 입력해
            주세요.
          </p>
        </CardHeader>
        <CardContent>
          <fetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="reauthenticate" />
            <div className="space-y-2">
              <Label htmlFor="admin-password">현재 비밀번호</Label>
              <Input
                id="admin-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {fetcher.data?.error ? (
              <p role="alert" className="text-sm text-destructive">
                {fetcher.data.error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "확인 중..." : "확인"}
            </Button>
          </fetcher.Form>
        </CardContent>
      </Card>
    </div>
  );
}

export function AppAdminsScreen({
  roster,
  candidates,
  query,
}: {
  roster: AdminMember[];
  candidates: AdminMember[];
  query: string;
}) {
  const fetcher = useFetcher<AdminActionResult>();
  const [target, setTarget] = useState<AdminMember | null>(null);
  const busy = fetcher.state !== "idle";
  const submit = () => {
    if (!target) return;
    void fetcher.submit(
      {
        intent: "set-admin",
        profileId: String(target.profile_id),
        enabled: String(!target.is_app_admin),
      },
      { method: "post" },
    );
    setTarget(null);
  };
  return (
    <div className="space-y-6 px-0 py-4 md:px-4">
      <Card className="rounded-none md:rounded-xl">
        <CardHeader>
          <CardTitle>앱 관리자 {roster.length}명</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <ul>
            {roster.map((person) => (
              <AdminPersonRow
                key={person.profile_id}
                person={person}
                status={<Badge variant="secondary">앱 관리자</Badge>}
                action={
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setTarget(person)}
                  >
                    강등 선택
                  </Button>
                }
              />
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card className="rounded-none md:rounded-xl">
        <CardHeader>
          <CardTitle>관리자 후보 검색</CardTitle>
          <AdminSearch query={query} label="앱 관리자 후보 검색" />
        </CardHeader>
        <CardContent className="px-0">
          <ul>
            {candidates.map((person) => (
              <AdminPersonRow
                key={person.profile_id}
                person={person}
                status={
                  person.is_app_admin ? (
                    <Badge variant="secondary">관리자</Badge>
                  ) : null
                }
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={person.is_app_admin}
                    onClick={() => setTarget(person)}
                  >
                    임명 선택
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
            target.is_app_admin ? "앱 관리자 강등 확인" : "앱 관리자 임명 확인"
          }
          description={`${target.name}(@${target.pub_id})님의 역할을 ${target.is_app_admin ? "일반 사용자로 강등" : "앱 관리자로 임명"}합니다. 대상과 역할 변경이 맞는지 확인해 주세요.`}
          confirmLabel={target.is_app_admin ? "강등" : "임명"}
          destructive={target.is_app_admin}
          pending={busy}
          onCancel={() => setTarget(null)}
          onConfirm={submit}
        />
      ) : null}
    </div>
  );
}

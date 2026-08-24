import { useState } from "react";
import { Link, useFetcher, useSearchParams } from "react-router";

import {
  formatApplicationField,
  formatDateTime,
  formatProfileType,
} from "~/features/admin/model/format";
import type {
  AdminActionResult,
  AdminApplication,
} from "~/features/admin/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { Button } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";
import { Checkbox } from "~/shared/ui/checkbox";

type PendingAction =
  | { kind: "review"; ids: number[]; status: "accepted" | "blocked" }
  | { kind: "unblock"; ids: number[] };

export function ApprovalsScreen({
  pending,
  blocked,
  pendingPage,
  blockedPage,
}: {
  pending: AdminApplication[];
  blocked: AdminApplication[];
  pendingPage: number;
  blockedPage: number;
}) {
  const fetcher = useFetcher<AdminActionResult>();
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [action, setAction] = useState<PendingAction | null>(null);
  const busy = fetcher.state !== "idle";
  const total = pending[0]?.total_count ?? 0;
  const blockedTotal = blocked[0]?.total_count ?? 0;

  function submitAction() {
    if (!action) return;
    const form = new FormData();
    form.set("intent", action.kind);
    for (const id of action.ids) form.append("profileId", String(id));
    if (action.kind === "review") form.set("status", action.status);
    void fetcher.submit(form, { method: "post" });
    if (action.kind === "review") setSelected(new Set());
    setAction(null);
  }

  return (
    <div className="space-y-6 px-0 py-4 md:px-4">
      <section aria-labelledby="pending-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-4 md:px-0">
          <div>
            <h2 id="pending-heading" className="text-xl font-semibold">
              승인 대기
            </h2>
            <p className="text-sm text-muted-foreground">
              총 {total}명, 한 번에 최대 200명
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!selected.size || busy}
              onClick={() =>
                setAction({
                  kind: "review",
                  ids: [...selected],
                  status: "accepted",
                })
              }
            >
              선택 승인
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!selected.size || busy}
              onClick={() =>
                setAction({
                  kind: "review",
                  ids: [...selected],
                  status: "blocked",
                })
              }
            >
              선택 차단
            </Button>
          </div>
        </div>
        {pending.length ? (
          <div className="space-y-3">
            <label className="flex items-center gap-2 px-4 text-sm md:px-0">
              <Checkbox
                checked={selected.size === pending.length}
                onCheckedChange={(checked) =>
                  setSelected(
                    checked
                      ? new Set(pending.map((item) => item.profile_id))
                      : new Set(),
                  )
                }
              />{" "}
              전체 선택
            </label>
            {pending.map((application) => (
              <ApplicationCard
                key={application.profile_id}
                application={application}
                selected={selected.has(application.profile_id)}
                onSelected={(checked) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (checked) next.add(application.profile_id);
                    else next.delete(application.profile_id);
                    return next;
                  })
                }
                actions={
                  <>
                    <Button
                      size="sm"
                      onClick={() =>
                        setAction({
                          kind: "review",
                          ids: [application.profile_id],
                          status: "accepted",
                        })
                      }
                    >
                      승인
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        setAction({
                          kind: "review",
                          ids: [application.profile_id],
                          status: "blocked",
                        })
                      }
                    >
                      차단
                    </Button>
                  </>
                }
              />
            ))}
            <ApplicationPagination
              page={pendingPage}
              total={total}
              parameter="pendingPage"
              searchParams={searchParams}
            />
          </div>
        ) : (
          <Empty text="대기 중인 신청이 없습니다." />
        )}
      </section>

      <section aria-labelledby="blocked-heading">
        <h2
          id="blocked-heading"
          className="mb-3 px-4 text-xl font-semibold md:px-0"
        >
          차단 사용자
        </h2>
        <div className="space-y-3">
          {blocked.map((application) => (
            <ApplicationCard
              key={application.profile_id}
              application={application}
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setAction({
                      kind: "unblock",
                      ids: [application.profile_id],
                    })
                  }
                >
                  차단 해제
                </Button>
              }
            />
          ))}
          {!blocked.length ? <Empty text="차단된 사용자가 없습니다." /> : null}
          <ApplicationPagination
            page={blockedPage}
            total={blockedTotal}
            parameter="blockedPage"
            searchParams={searchParams}
          />
        </div>
      </section>
      {fetcher.data?.error ? (
        <p role="alert" className="px-4 text-sm text-destructive md:px-0">
          {fetcher.data.error}
        </p>
      ) : null}
      {action ? (
        <ConfirmDialog
          title={
            action.kind === "unblock"
              ? "차단 해제"
              : action.status === "accepted"
                ? "가입 승인"
                : "가입 차단"
          }
          description={`${action.ids.length}명의 상태를 변경합니다. 계속할까요?`}
          confirmLabel="확인"
          destructive={action.kind === "review" && action.status === "blocked"}
          pending={busy}
          onCancel={() => setAction(null)}
          onConfirm={submitAction}
        />
      ) : null}
    </div>
  );
}

function ApplicationCard({
  application,
  selected,
  onSelected,
  actions,
}: {
  application: AdminApplication;
  selected?: boolean;
  onSelected?: (checked: boolean) => void;
  actions: React.ReactNode;
}) {
  const fields: [string, AdminApplication[keyof AdminApplication]][] = [
    ["사용자 유형", formatProfileType(application.profile_type)],
    ["재입학", application.is_returning_student],
    ["기수", application.cohort],
    ["반", application.class_no],
    ["계열", application.academic_track],
    ["부서", application.department],
    ["학번", application.student_number],
    ["성별", application.gender],
    ["생일", application.birthday],
    ["전화번호", application.phone_number],
    ["기숙사 방", application.dorm_room],
    ["자기소개", application.description],
  ];
  return (
    <Card className="rounded-none md:rounded-xl">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start gap-3">
          {onSelected ? (
            <Checkbox
              aria-label={`${application.name} 선택`}
              checked={selected}
              onCheckedChange={onSelected}
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <CardTitle>{application.name}</CardTitle>
            <p className="text-xs text-muted-foreground">
              @{application.pub_id} · 신청{" "}
              {formatDateTime(application.submitted_at)}
            </p>
          </div>
          <div className="ml-auto flex w-full justify-end gap-2 sm:w-auto">
            {actions}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          {fields.map(([label, value]) => (
            <div
              key={label}
              className={label === "자기소개" ? "col-span-full" : ""}
            >
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 break-words">
                {formatApplicationField(value)}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function ApplicationPagination({
  page,
  total,
  parameter,
  searchParams,
}: {
  page: number;
  total: number;
  parameter: "pendingPage" | "blockedPage";
  searchParams: URLSearchParams;
}) {
  const hasPrevious = page > 1;
  const hasNext = page * 200 < total;
  if (!hasPrevious && !hasNext) return null;

  function href(nextPage: number): string {
    const next = new URLSearchParams(searchParams);
    if (nextPage === 1) next.delete(parameter);
    else next.set(parameter, String(nextPage));
    return `?${next.toString()}`;
  }

  return (
    <nav
      aria-label="신청 목록 페이지"
      className="flex justify-end gap-2 px-4 md:px-0"
    >
      {hasPrevious ? (
        <Button
          variant="outline"
          size="sm"
          render={<Link to={href(page - 1)} />}
        >
          이전
        </Button>
      ) : null}
      {hasNext ? (
        <Button
          variant="outline"
          size="sm"
          render={<Link to={href(page + 1)} />}
        >
          다음
        </Button>
      ) : null}
    </nav>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="border-y bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground md:rounded-xl md:border">
      {text}
    </div>
  );
}

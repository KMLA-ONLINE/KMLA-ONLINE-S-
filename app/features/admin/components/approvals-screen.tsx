import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Link, useFetcher, useSearchParams } from "react-router";
import { toast } from "sonner";

import { RejectionDialog } from "~/features/admin/components/rejection-dialog";
import {
  formatApplicationField,
  formatProfileType,
} from "~/features/admin/model/format";
import { useLocale, useT, type Translate } from "~/shared/i18n";
import { formatDateTime } from "~/shared/lib/time";
import type {
  AdminActionResult,
  AdminApplication,
} from "~/features/admin/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { Button } from "~/shared/ui/button";
import { Checkbox } from "~/shared/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";

type PendingAction =
  | { kind: "review"; ids: number[]; status: "accepted" | "blocked" }
  | { kind: "unblock"; ids: number[] };

type Tab = "pending" | "blocked";

// 반려는 되돌릴 수 있는 처리라 차단(빨강)과 구분되는 경고색을 쓴다. 프로젝트에 경고 토큰이 없어 다른 경고 표시처럼 amber를 쓴다.
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
  const t = useT();
  const fetcher = useFetcher<AdminActionResult>();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>("pending");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectedPage, setSelectedPage] = useState(pendingPage);
  const [action, setAction] = useState<PendingAction | null>(null);
  const [rejecting, setRejecting] = useState<AdminApplication | null>(null);
  const closeRejection = useCallback(() => setRejecting(null), []);
  const submitted = useRef<PendingAction | null>(null);
  const busy = fetcher.state !== "idle";
  const total = pending[0]?.total_count ?? 0;
  const blockedTotal = blocked[0]?.total_count ?? 0;
  // 선택은 지금 보는 페이지에만 유효하다. 다른 페이지로 가면 비운다.
  if (selectedPage !== pendingPage) {
    setSelectedPage(pendingPage);
    setSelected(new Set());
  }
  const selectedIds = pending
    .map((item) => item.profile_id)
    .filter((id) => selected.has(id));

  useEffect(() => {
    const done = submitted.current;
    if (fetcher.state !== "idle" || !fetcher.data || !done) return;
    submitted.current = null;
    if (fetcher.data.error) toast.error(fetcher.data.error);
    else toast.success(actionCopy(done, t).done);
  }, [fetcher.state, fetcher.data, t]);

  function submitAction() {
    if (!action) return;
    const form = new FormData();
    form.set("intent", action.kind);
    for (const id of action.ids) form.append("profileId", String(id));
    if (action.kind === "review") form.set("status", action.status);
    submitted.current = action;
    void fetcher.submit(form, { method: "post" });
    // 처리한 사람이 나중에 차단 해제로 돌아와도 미리 선택된 채로 나타나지 않게 한다.
    if (action.kind === "review")
      setSelected((current) => {
        const next = new Set(current);
        for (const id of action.ids) next.delete(id);
        return next;
      });
    setAction(null);
  }

  function toggle(id: number, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const allSelected =
    pending.length > 0 && selectedIds.length === pending.length;
  const copy = action ? actionCopy(action, t) : null;

  return (
    <div className="space-y-4 px-0 py-4 md:px-4">
      <div
        role="tablist"
        aria-label={t("신청 상태")}
        className="flex gap-1 px-4 md:px-0"
      >
        {(
          [
            ["pending", "승인 대기", total],
            ["blocked", "차단", blockedTotal],
          ] as const
        ).map(([value, label, count]) => (
          <Button
            key={value}
            role="tab"
            aria-selected={tab === value}
            variant={tab === value ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTab(value)}
          >
            {t(label)}
            <span className="text-muted-foreground tabular-nums">{count}</span>
          </Button>
        ))}
      </div>
      {/* 토스트는 곧 사라지므로 실패는 다음 처리 전까지 화면에 남긴다. */}
      {fetcher.data?.error ? (
        <p role="alert" className="px-4 text-sm text-destructive md:px-0">
          {fetcher.data.error}
        </p>
      ) : null}

      {tab === "pending" ? (
        <section role="tabpanel" aria-label={t("승인 대기")}>
          {pending.length ? (
            <>
              <div className="flex items-center justify-between gap-3 border-b px-4 pb-2 text-sm md:px-3">
                <label className="flex items-center gap-3">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={selectedIds.length > 0 && !allSelected}
                    onCheckedChange={(checked) =>
                      setSelected(
                        checked
                          ? new Set(pending.map((item) => item.profile_id))
                          : new Set(),
                      )
                    }
                  />{" "}
                  {t("전체 선택")}
                </label>
                <span className="text-muted-foreground">
                  {t("한 번에 최대 200명")}
                </span>
              </div>
              <ul className="divide-y border-b">
                {pending.map((application) => (
                  <ApplicationRow
                    key={application.profile_id}
                    application={application}
                    selected={selected.has(application.profile_id)}
                    onSelected={(checked) =>
                      toggle(application.profile_id, checked)
                    }
                    actions={
                      <>
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            setAction({
                              kind: "review",
                              ids: [application.profile_id],
                              status: "accepted",
                            })
                          }
                        >
                          {t("승인")}
                        </Button>
                        {/* 대부분은 오입력이라 반려가 기본 동작이고, 차단은 외부인·악용 의심에만 쓰므로 메뉴에 둔다. */}
                        {/* 버튼은 투명 테두리 안쪽에만 배경을 칠한다. 반려 쪽 테두리를 없애고 메뉴 쪽 테두리만 색을 칠해 바탕이 비치지 않는 구분선 하나를 둔다. */}
                        <div className="flex">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="rounded-r-none border-r-0"
                            disabled={busy}
                            onClick={() => setRejecting(application)}
                          >
                            {t("반려")}
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              disabled={busy}
                              render={
                                <Button
                                  size="icon-sm"
                                  variant="destructive"
                                  className="rounded-l-none border-l-destructive/20"
                                  aria-label={t("{name} 신청 다른 처리", {
                                    name: application.name,
                                  })}
                                />
                              }
                            >
                              <ChevronDownIcon />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() =>
                                  setAction({
                                    kind: "review",
                                    ids: [application.profile_id],
                                    status: "blocked",
                                  })
                                }
                              >
                                {t("차단")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </>
                    }
                  />
                ))}
              </ul>
              <ApplicationPagination
                page={pendingPage}
                total={total}
                parameter="pendingPage"
                searchParams={searchParams}
              />
              {selectedIds.length ? (
                <div className="sticky bottom-0 z-10 mt-3 flex items-center gap-2 border-t bg-background px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] shadow-sm md:rounded-xl md:border">
                  <p className="mr-auto text-sm font-medium" aria-live="polite">
                    {t("{count}명 선택됨", { count: selectedIds.length })}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelected(new Set())}
                  >
                    {t("선택 해제")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      setAction({
                        kind: "review",
                        ids: selectedIds,
                        status: "accepted",
                      })
                    }
                  >
                    {t("승인")}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      setAction({
                        kind: "review",
                        ids: selectedIds,
                        status: "blocked",
                      })
                    }
                  >
                    {t("차단")}
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <Empty text={t("대기 중인 신청이 없습니다.")} />
          )}
        </section>
      ) : (
        <section role="tabpanel" aria-label={t("차단")}>
          {blocked.length ? (
            <>
              <ul className="divide-y border-y md:rounded-xl md:border">
                {blocked.map((application) => (
                  <ApplicationRow
                    key={application.profile_id}
                    application={application}
                    actions={
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          setAction({
                            kind: "unblock",
                            ids: [application.profile_id],
                          })
                        }
                      >
                        {t("차단 해제")}
                      </Button>
                    }
                  />
                ))}
              </ul>
              <ApplicationPagination
                page={blockedPage}
                total={blockedTotal}
                parameter="blockedPage"
                searchParams={searchParams}
              />
            </>
          ) : (
            <Empty text={t("차단된 사용자가 없습니다.")} />
          )}
        </section>
      )}

      {action && copy ? (
        <ConfirmDialog
          title={copy.title}
          description={copy.description}
          confirmLabel={copy.confirm}
          destructive={action.kind === "review" && action.status === "blocked"}
          pending={busy}
          onCancel={() => setAction(null)}
          onConfirm={submitAction}
        />
      ) : null}
      <RejectionDialog
        key={rejecting?.profile_id ?? "closed"}
        application={rejecting}
        onOpenChange={closeRejection}
      />
    </div>
  );
}

function actionCopy(action: PendingAction, t: Translate) {
  const count = action.ids.length;
  if (action.kind === "unblock")
    return {
      title: t("차단 해제"),
      description: t("{count}명의 가입 차단을 해제할까요?", { count }),
      confirm: t("차단 해제"),
      done: t("{count}명의 차단을 해제했습니다.", { count }),
    };
  if (action.status === "accepted")
    return {
      title: t("가입 승인"),
      description: t("{count}명의 가입을 승인할까요?", { count }),
      confirm: t("승인"),
      done: t("{count}명을 승인했습니다.", { count }),
    };
  return {
    title: t("가입 차단"),
    description: t("{count}명의 가입을 차단할까요?", { count }),
    confirm: t("차단"),
    done: t("{count}명을 차단했습니다.", { count }),
  };
}

function ApplicationRow({
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
  const t = useT();
  const locale = useLocale();
  const details = [
    formatProfileType(application.profile_type, locale),
    application.cohort == null
      ? null
      : t("{cohort}기", { cohort: application.cohort }),
    application.student_number
      ? t("학번 {number}", { number: application.student_number })
      : null,
    application.gender
      ? formatApplicationField(application.gender, locale)
      : null,
    application.birthday
      ? t("생일 {date}", { date: application.birthday })
      : null,
    application.is_returning_student ? t("복학생") : null,
  ].filter(Boolean);
  return (
    <li
      className="flex items-center gap-3 px-4 py-3 md:px-3 data-selected:bg-muted/50"
      data-selected={selected ? true : undefined}
    >
      {onSelected ? (
        <Checkbox
          aria-label={t("{name} 선택", { name: application.name })}
          checked={selected}
          onCheckedChange={onSelected}
        />
      ) : null}
      {/* 행 아무 곳이나 눌러도 선택되게 한다. 키보드와 스크린 리더는 체크박스로 같은 동작을 한다. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className={
          onSelected ? "min-w-0 flex-1 cursor-pointer" : "min-w-0 flex-1"
        }
        onClick={
          onSelected
            ? () => {
                // 이름이나 학번을 복사하려고 드래그한 경우는 선택으로 치지 않는다.
                if (window.getSelection()?.toString()) return;
                onSelected(!selected);
              }
            : undefined
        }
      >
        <p className="truncate font-medium">{application.name}</p>
        <p className="text-sm text-muted-foreground">{details.join(" · ")}</p>
        <p className="text-xs text-muted-foreground">
          {t("신청 {time}", {
            time: formatDateTime(application.submitted_at, locale),
          })}
        </p>
        {application.rejection_count > 0 ? (
          <p className="text-xs break-words text-muted-foreground">
            {t("이전 반려 {count}회", { count: application.rejection_count })} ·{" "}
            {application.last_rejection_reason}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2">{actions}</div>
    </li>
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
  const t = useT();
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
      aria-label={t("신청 목록 페이지")}
      className="mt-3 flex justify-end gap-2 px-4 md:px-0"
    >
      {hasPrevious ? (
        <Button
          variant="outline"
          size="sm"
          render={<Link to={href(page - 1)} />}
        >
          {t("이전")}
        </Button>
      ) : null}
      {hasNext ? (
        <Button
          variant="outline"
          size="sm"
          render={<Link to={href(page + 1)} />}
        >
          {t("다음")}
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

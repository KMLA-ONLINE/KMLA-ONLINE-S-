import {
  BadgeCheckIcon,
  Globe2Icon,
  LandmarkIcon,
  LockIcon,
  LogOutIcon,
  MessageSquareTextIcon,
  MoreHorizontalIcon,
  PinIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";
import { useFetcher, useSearchParams } from "react-router";

import { GroupAvatar } from "~/features/groups/components/group-avatar";
import {
  GroupConfirmDialog,
  GroupJoinRequestDialog,
} from "~/features/groups/components/group-confirm-dialog";
import {
  getGroupIdentityPolicyLabel,
  getGroupJoinPolicyLabel,
  getGroupPostingPolicyLabel,
} from "~/features/groups/model/format";
import type { GroupDetail } from "~/features/groups/model/types";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { Spinner } from "~/shared/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/shared/ui/tooltip";

type GroupTab = "posts" | "members" | "settings";

const GROUP_TABS: {
  id: GroupTab;
  label: string;
}[] = [
  { id: "posts", label: "게시물" },
  { id: "members", label: "멤버" },
  { id: "settings", label: "그룹 설정" },
];

export function GroupDetailScreen({
  group,
  profileId,
  isTeacher,
}: {
  group: GroupDetail;
  profileId: number;
  isTeacher: boolean;
}) {
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const pending = fetcher.state !== "idle";
  const isMember = group.membership_state === "member";
  const isPrivate = group.join_policy === "invite_only";
  const VisibilityIcon = isPrivate ? LockIcon : Globe2Icon;
  const [leaveOpen, setLeaveOpen] = useState(false);
  // 기능 명세 7.12: 공식 그룹은 나갈 수 없고, 소유자는 소유권을 이전해야 나갈 수 있다.
  const canLeave =
    isMember && group.kind !== "official" && group.member_role !== "owner";
  const canManage =
    group.member_role === "owner" || group.member_role === "admin";
  const canCurate = canManage || group.member_role === "manager";
  const canViewMembers =
    group.identity_policy !== "always_anonymous" || canManage;
  const requestedTab = searchParams.get("tab");
  const tab: GroupTab =
    (requestedTab === "members" && canViewMembers) ||
    (requestedTab === "settings" && canCurate)
      ? requestedTab
      : "posts";
  const visibleTabs = GROUP_TABS.filter(
    (item) =>
      (item.id !== "members" || canViewMembers) &&
      (item.id !== "settings" || canCurate),
  );

  const setTab = (nextTab: GroupTab) => {
    const next = new URLSearchParams(searchParams);
    if (nextTab === "posts") next.delete("tab");
    else next.set("tab", nextTab);
    setSearchParams(next, { preventScrollReset: true });
  };

  return (
    <div className="pb-10 md:pt-0">
      <section className="overflow-hidden border-b bg-card md:rounded-xl md:border">
        <div className="relative aspect-[4/1] w-full overflow-hidden bg-gradient-to-br from-primary/30 to-primary/5">
          {group.cover_path ? (
            <img
              src={group.cover_path}
              alt=""
              width={1200}
              height={300}
              fetchPriority="high"
              className="size-full object-cover"
            />
          ) : null}
        </div>

        <div className="flex items-start gap-5 p-4 py-3 md:py-4">
          <GroupAvatar
            name={group.name}
            iconPath={group.icon_path}
            className="hidden size-16 shrink-0 rounded-xl text-xl sm:flex sm:size-20"
          />
          <div className="min-w-0 flex-1 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-bold">{group.name}</h1>
              {group.kind === "official" ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span
                        role="img"
                        aria-label="공식 그룹"
                        className="inline-flex shrink-0 cursor-default"
                      />
                    }
                  >
                    <BadgeCheckIcon
                      aria-hidden
                      className="size-6 text-primary"
                    />
                  </TooltipTrigger>
                  <TooltipContent>공식 그룹입니다</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <VisibilityIcon aria-hidden className="size-3.5 shrink-0" />
              {isPrivate ? "비공개 그룹" : "공개 그룹"} · 멤버{" "}
              {group.member_count.toLocaleString("ko-KR")}명
            </p>
            {group.identity_policy === "always_anonymous" ? (
              <p className="mt-1 text-xs text-muted-foreground">
                게시물과 댓글이 모두 익명으로 표시됩니다.
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 pt-1">
            <div className="flex flex-wrap justify-end gap-2">
              <MembershipAction
                group={group}
                profileId={profileId}
                isTeacher={isTeacher}
              />
              {isMember ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="그룹 옵션"
                        disabled={pending}
                      />
                    }
                  >
                    {pending ? <Spinner /> : <MoreHorizontalIcon />}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-auto whitespace-nowrap"
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>내 그룹 설정</DropdownMenuLabel>
                      <DropdownMenuItem
                        disabled={pending}
                        onClick={() =>
                          void fetcher.submit(
                            {
                              intent: "pin",
                              groupId: group.group_id,
                              profileId: String(profileId),
                              pinned: group.pinned_at ? "false" : "true",
                            },
                            { method: "post" },
                          )
                        }
                      >
                        <PinIcon />
                        {group.pinned_at ? "고정 해제" : "내 그룹에 고정"}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    {canLeave ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={pending}
                          onClick={() => setLeaveOpen(true)}
                        >
                          <LogOutIcon />
                          그룹 탈퇴
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
            {fetcher.data?.error ? (
              <p role="alert" className="text-xs text-destructive">
                {fetcher.data.error}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <nav
        className="mx-2 mt-1 hidden items-center gap-1 border-b md:flex"
        aria-label="그룹 메뉴"
      >
        {visibleTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === item.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="grid gap-6 py-3 md:py-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 lg:order-1">
          {tab === "posts" ? (
            <EmptyTabCard
              icon={<MessageSquareTextIcon aria-hidden />}
              title="게시물"
              description="아직 게시물이 없습니다."
            />
          ) : tab === "members" ? (
            <EmptyTabCard
              icon={<UsersIcon aria-hidden />}
              title={`멤버 ${group.member_count.toLocaleString("ko-KR")}`}
              description="멤버 명부 기능을 준비하고 있습니다."
            />
          ) : (
            <EmptyTabCard
              icon={<SettingsIcon aria-hidden />}
              title="그룹 설정"
              description="그룹 설정 기능을 준비하고 있습니다."
            />
          )}
        </div>

        <aside className="hidden lg:order-2 lg:block">
          <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 lg:sticky lg:top-4">
            <h2 className="text-sm font-semibold">그룹 정보</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {group.description || "아직 그룹 설명이 없습니다."}
            </p>
            <InfoRow icon={<LandmarkIcon />}>
              {group.kind === "official" ? "공식 그룹" : "비공식 그룹"}
            </InfoRow>
            <InfoRow icon={<VisibilityIcon />}>
              {isPrivate ? "비공개" : "공개"} ·{" "}
              {getGroupJoinPolicyLabel(group.join_policy)}
            </InfoRow>
            <InfoRow icon={<UsersIcon />}>
              멤버 {group.member_count.toLocaleString("ko-KR")}명
            </InfoRow>
            <InfoRow icon={<MessageSquareTextIcon />}>
              {getGroupIdentityPolicyLabel(group.identity_policy)} ·{" "}
              {getGroupPostingPolicyLabel(group.posting_policy)}
            </InfoRow>
          </div>
        </aside>
      </div>

      <GroupConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={group.name}
        description={
          isPrivate
            ? "이 그룹에서 탈퇴할까요? 초대 전용 그룹이라 다시 들어오려면 새 초대를 받아야 합니다."
            : group.join_policy === "request"
              ? "이 그룹에서 탈퇴할까요? 다시 들어오려면 가입 요청과 승인을 거쳐야 합니다."
              : "이 그룹에서 탈퇴할까요? 공개 그룹이라 언제든 다시 가입할 수 있습니다."
        }
        confirmLabel="탈퇴"
        confirmVariant="destructive"
        pending={pending}
        onConfirm={() => {
          setLeaveOpen(false);
          void fetcher.submit(
            {
              intent: "leave",
              groupId: group.group_id,
              profileId: String(profileId),
            },
            { method: "post" },
          );
        }}
      />
    </div>
  );
}

function EmptyTabCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="h-fit rounded-none border-x-0 md:rounded-xl md:border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 [&_svg]:size-5">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
          {description}
        </div>
      </CardContent>
    </Card>
  );
}

function MembershipAction({
  group,
  profileId,
  isTeacher,
}: {
  group: GroupDetail;
  profileId: number;
  isTeacher: boolean;
}) {
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const pending = fetcher.state !== "idle";
  const actionError = fetcher.data?.error ?? null;
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (group.membership_state === "requested") {
    return (
      <div>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="cancel-request" />
          <input type="hidden" name="groupId" value={group.group_id} />
          <input type="hidden" name="profileId" value={profileId} />
          <Button type="submit" variant="outline" disabled={pending}>
            가입 요청 취소
          </Button>
        </fetcher.Form>
        {actionError ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {actionError}
          </p>
        ) : null}
      </div>
    );
  }

  const canJoin =
    !isTeacher &&
    group.membership_state === "none" &&
    group.join_policy === "open";
  const canRequest =
    !isTeacher &&
    group.membership_state === "none" &&
    group.join_policy === "request";

  if (!canJoin && !canRequest) return null;

  return (
    <div>
      {canJoin ? (
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="join" />
          <input type="hidden" name="groupId" value={group.group_id} />
          <input type="hidden" name="profileId" value={profileId} />
          <Button type="submit" disabled={pending}>
            {pending && <Spinner data-icon="inline-start" />}
            그룹 가입
          </Button>
        </fetcher.Form>
      ) : (
        <>
          <Button
            type="button"
            disabled={pending}
            onClick={() => setConfirmOpen(true)}
          >
            {pending && <Spinner data-icon="inline-start" />}
            가입 요청
          </Button>
          <GroupJoinRequestDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            groupName={group.name}
            pending={pending}
            onConfirm={() => {
              setConfirmOpen(false);
              void fetcher.submit(
                {
                  intent: "request",
                  groupId: group.group_id,
                  profileId: String(profileId),
                },
                { method: "post" },
              );
            }}
          />
        </>
      )}
      {actionError ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}

function InfoRow({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground [&_svg]:size-4">
      {icon}
      <span>{children}</span>
    </div>
  );
}

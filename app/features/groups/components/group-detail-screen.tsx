import {
  BadgeCheckIcon,
  BellIcon,
  Globe2Icon,
  LandmarkIcon,
  LockIcon,
  MessageSquareTextIcon,
  MoreHorizontalIcon,
  PinIcon,
  UsersIcon,
} from "lucide-react";
import { useFetcher } from "react-router";

import { GroupAvatar } from "~/features/groups/components/group-avatar";
import {
  getGroupIdentityPolicyLabel,
  getGroupJoinPolicyLabel,
  getGroupMemberRoleLabel,
  getGroupPostingPolicyLabel,
} from "~/features/groups/model/format";
import type { GroupDetail } from "~/features/groups/model/types";
import { Button } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { Spinner } from "~/shared/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/shared/ui/tooltip";

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
  const pending = fetcher.state !== "idle";
  const isMember = group.membership_state === "member";
  const isPrivate = group.join_policy === "invite_only";
  const VisibilityIcon = isPrivate ? LockIcon : Globe2Icon;

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
            className="hidden size-16 shrink-0 rounded-xl text-xl shadow-xs sm:flex sm:size-20"
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
              {group.member_role ? (
                <> · {getGroupMemberRoleLabel(group.member_role)}</>
              ) : null}
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
                  <DropdownMenuContent align="end" className="w-48">
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

      <div className="grid gap-6 px-4 py-4 md:px-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="order-2 h-fit lg:order-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareTextIcon aria-hidden className="size-5" />
              그룹 활동
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
              아직 표시할 활동이 없습니다.
            </div>
          </CardContent>
        </Card>

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
    </div>
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
      <fetcher.Form method="post">
        <input
          type="hidden"
          name="intent"
          value={canJoin ? "join" : "request"}
        />
        <input type="hidden" name="groupId" value={group.group_id} />
        <input type="hidden" name="profileId" value={profileId} />
        <Button type="submit" disabled={pending}>
          {pending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <BellIcon data-icon="inline-start" />
          )}
          {canJoin ? "그룹 가입" : "가입 요청"}
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

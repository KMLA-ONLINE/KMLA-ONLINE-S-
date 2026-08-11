import {
  BellIcon,
  EyeIcon,
  LockIcon,
  MessageSquareTextIcon,
  PinIcon,
  ShieldCheckIcon,
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
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";
import { Spinner } from "~/shared/ui/spinner";

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

  return (
    <div className="pb-10 md:pt-6">
      <section className="overflow-hidden border-y bg-card md:rounded-2xl md:border">
        <div className="relative aspect-[5/2] min-h-40 overflow-hidden bg-muted">
          {group.cover_path ? (
            <img
              src={group.cover_path}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_25%,color-mix(in_oklch,var(--primary)_24%,transparent),transparent_42%),linear-gradient(135deg,var(--muted),var(--card))]" />
          )}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-foreground/25 to-transparent" />
        </div>

        <div className="relative px-4 pb-5 md:px-6">
          <GroupAvatar
            name={group.name}
            iconPath={group.icon_path}
            className="-mt-10 size-20 border-4 border-card text-xl shadow-sm"
          />
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {group.name}
                </h1>
                {group.kind === "official" ? (
                  <Badge>
                    <ShieldCheckIcon data-icon="inline-start" />
                    공식
                  </Badge>
                ) : null}
                {group.join_policy === "invite_only" ? (
                  <Badge variant="secondary">
                    <LockIcon data-icon="inline-start" />
                    비공개
                  </Badge>
                ) : null}
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                <UsersIcon aria-hidden className="size-4" />
                멤버 {group.member_count.toLocaleString("ko-KR")}명
                {group.member_role ? (
                  <> · {getGroupMemberRoleLabel(group.member_role)}</>
                ) : null}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isMember ? (
                <div>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="pin" />
                    <input
                      type="hidden"
                      name="groupId"
                      value={group.group_id}
                    />
                    <input type="hidden" name="profileId" value={profileId} />
                    <input
                      type="hidden"
                      name="pinned"
                      value={group.pinned_at ? "false" : "true"}
                    />
                    <Button type="submit" variant="outline" disabled={pending}>
                      {pending ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <PinIcon data-icon="inline-start" />
                      )}
                      {group.pinned_at ? "고정 해제" : "내 그룹에 고정"}
                    </Button>
                  </fetcher.Form>
                  {fetcher.data?.error ? (
                    <p role="alert" className="mt-1 text-xs text-destructive">
                      {fetcher.data.error}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <MembershipAction
                group={group}
                profileId={profileId}
                isTeacher={isTeacher}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 px-4 py-5 md:grid-cols-[minmax(0,1fr)_16rem] md:px-0">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>그룹 소개</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="leading-7 whitespace-pre-wrap text-muted-foreground">
                {group.description || "아직 그룹 설명이 없습니다."}
              </p>
            </CardContent>
          </Card>
          <Card>
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
        </div>

        <aside className="flex flex-col gap-3">
          <PolicyItem
            icon={<UsersIcon />}
            label="가입 정책"
            value={getGroupJoinPolicyLabel(group.join_policy)}
          />
          <PolicyItem
            icon={<EyeIcon />}
            label="활동 신원"
            value={getGroupIdentityPolicyLabel(group.identity_policy)}
          />
          <PolicyItem
            icon={<MessageSquareTextIcon />}
            label="글쓰기"
            value={getGroupPostingPolicyLabel(group.posting_policy)}
          />
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

function PolicyItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
      <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
        {icon}
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

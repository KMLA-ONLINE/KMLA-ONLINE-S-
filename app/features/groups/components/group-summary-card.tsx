import { BellRingIcon, PinIcon, UsersIcon } from "lucide-react";
import { Link, useFetcher } from "react-router";

import {
  getGroupIdentityPolicyLabel,
  getGroupJoinPolicyLabel,
} from "~/features/groups/model/format";
import type {
  GroupIdentityPolicy,
  GroupJoinPolicy,
  GroupMembershipState,
} from "~/features/groups/model/types";
import { GroupAvatar } from "~/features/groups/components/group-avatar";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/shared/ui/card";
import { Spinner } from "~/shared/ui/spinner";

interface GroupSummaryCardProps {
  group: {
    group_id: string;
    slug: string;
    name: string;
    description: string;
    join_policy: GroupJoinPolicy;
    identity_policy: GroupIdentityPolicy;
    icon_path: string | null;
    member_count: number;
    membership_state: GroupMembershipState;
    pinned_at?: string | null;
  };
  profileId: number;
  showPin?: boolean;
}

export function GroupSummaryCard({
  group,
  profileId,
  showPin = false,
}: GroupSummaryCardProps) {
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const pending = fetcher.state !== "idle";
  const isMember = group.membership_state === "member";
  const isRequested = group.membership_state === "requested";
  const actionError = fetcher.data?.error ?? null;

  return (
    <Card className="h-full transition-shadow hover:shadow-md">
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <GroupAvatar
            name={group.name}
            iconPath={group.icon_path}
            className="size-11 shrink-0"
          />
          <div className="min-w-0">
            <CardTitle>
              <Link
                to={`/groups/${group.slug}`}
                className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {group.name}
              </Link>
            </CardTitle>
            <CardDescription className="mt-0.5 flex items-center gap-1">
              <UsersIcon aria-hidden className="size-3.5" />
              멤버 {group.member_count.toLocaleString("ko-KR")}명
            </CardDescription>
          </div>
        </div>
        {showPin && isMember ? (
          <CardAction>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="pin" />
              <input type="hidden" name="groupId" value={group.group_id} />
              <input type="hidden" name="profileId" value={profileId} />
              <input
                type="hidden"
                name="pinned"
                value={group.pinned_at ? "false" : "true"}
              />
              <Button
                type="submit"
                variant={group.pinned_at ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label={group.pinned_at ? "고정 해제" : "그룹 고정"}
                aria-pressed={Boolean(group.pinned_at)}
                disabled={pending}
              >
                {pending ? <Spinner /> : <PinIcon />}
              </Button>
            </fetcher.Form>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
          {group.description || "아직 그룹 설명이 없습니다."}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">
            {getGroupJoinPolicyLabel(group.join_policy)}
          </Badge>
          {group.identity_policy === "always_anonymous" ? (
            <Badge variant="outline">
              {getGroupIdentityPolicyLabel(group.identity_policy)}
            </Badge>
          ) : null}
        </div>
        {actionError ? (
          <p role="alert" className="text-sm text-destructive">
            {actionError}
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="justify-end gap-2">
        {isMember ? (
          <Button
            variant="outline"
            render={<Link to={`/groups/${group.slug}`} />}
          >
            그룹 보기
          </Button>
        ) : null}
        {isRequested ? (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="cancel-request" />
            <input type="hidden" name="groupId" value={group.group_id} />
            <input type="hidden" name="profileId" value={profileId} />
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              요청 취소
            </Button>
          </fetcher.Form>
        ) : null}
        {!isMember && !isRequested && group.join_policy !== "invite_only" ? (
          <fetcher.Form method="post">
            <input
              type="hidden"
              name="intent"
              value={group.join_policy === "open" ? "join" : "request"}
            />
            <input type="hidden" name="groupId" value={group.group_id} />
            <input type="hidden" name="profileId" value={profileId} />
            <Button type="submit" disabled={pending}>
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <BellRingIcon data-icon="inline-start" />
              )}
              {group.join_policy === "open" ? "가입" : "가입 요청"}
            </Button>
          </fetcher.Form>
        ) : null}
      </CardFooter>
    </Card>
  );
}

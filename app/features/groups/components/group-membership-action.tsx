import { useState } from "react";
import { Link, useFetcher } from "react-router";

import { GroupJoinRequestDialog } from "~/features/groups/components/group-confirm-dialog";
import type {
  GroupJoinPolicy,
  GroupMembershipState,
} from "~/features/groups/model/types";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";

interface MembershipGroup {
  group_id: string;
  slug: string;
  name: string;
  join_policy: GroupJoinPolicy;
  membership_state: GroupMembershipState;
}

export function GroupMembershipAction({
  group,
  profileId,
  isTeacher = false,
  memberLabel = "열기",
  joinLabel = "가입",
  hideUnavailable = false,
  fullWidth = false,
}: {
  group: MembershipGroup;
  profileId: number;
  isTeacher?: boolean;
  memberLabel?: string | null;
  joinLabel?: string;
  hideUnavailable?: boolean;
  fullWidth?: boolean;
}) {
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const pending = fetcher.state !== "idle";
  const actionError = fetcher.data?.error ?? null;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const buttonClassName = fullWidth ? "w-full" : undefined;

  if (group.membership_state === "member") {
    if (!memberLabel) return null;

    return (
      <Button
        variant="outline"
        className={buttonClassName}
        nativeButton={false}
        render={<Link to={`/groups/${group.slug}`} />}
      >
        {memberLabel}
      </Button>
    );
  }

  const requested = group.membership_state === "requested";
  if (
    !requested &&
    (isTeacher || (hideUnavailable && group.join_policy === "invite_only"))
  ) {
    return null;
  }

  // 승인제 그룹의 새 요청만 확인한다. 즉시 가입과 요청 취소는 바로 제출한다.
  const needsConfirm = !requested && group.join_policy === "request";

  return (
    <div className={cn(fullWidth && "w-full")}>
      {needsConfirm ? (
        <>
          <Button
            type="button"
            className={buttonClassName}
            disabled={pending}
            onClick={() => setConfirmOpen(true)}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
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
      ) : (
        <fetcher.Form method="post">
          <input
            type="hidden"
            name="intent"
            value={
              requested
                ? "cancel-request"
                : group.join_policy === "open"
                  ? "join"
                  : "request"
            }
          />
          <input type="hidden" name="groupId" value={group.group_id} />
          <input type="hidden" name="profileId" value={profileId} />
          <Button
            type="submit"
            variant={requested ? "outline" : "default"}
            className={buttonClassName}
            disabled={pending || group.join_policy === "invite_only"}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {requested
              ? "가입 요청 취소"
              : group.join_policy === "open"
                ? joinLabel
                : "초대 전용"}
          </Button>
        </fetcher.Form>
      )}
      {actionError ? (
        <p
          role="alert"
          className={cn(
            "text-destructive",
            fullWidth ? "mt-2 text-sm" : "mt-1 text-xs",
          )}
        >
          {actionError}
        </p>
      ) : null}
    </div>
  );
}

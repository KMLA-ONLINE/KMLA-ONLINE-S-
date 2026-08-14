import { MoreHorizontalIcon, ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { useFetcher } from "react-router";

import { GroupConfirmDialog } from "~/features/groups/components/group-confirm-dialog";
import { getGroupMemberRoleLabel } from "~/features/groups/model/format";
import type {
  GroupMember,
  GroupMemberRole,
} from "~/features/groups/model/types";
import { Button } from "~/shared/ui/button";
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

const ASSIGNABLE_ROLES: Exclude<GroupMemberRole, "owner">[] = [
  "admin",
  "manager",
  "member",
];

export function MemberRoleMenu({
  groupId,
  member,
  viewerRole,
}: {
  groupId: string;
  member: GroupMember;
  viewerRole: GroupMemberRole | null;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const [transferOpen, setTransferOpen] = useState(false);
  const pending = fetcher.state !== "idle";
  const canSetRole =
    (viewerRole === "owner" || viewerRole === "admin") &&
    member.role !== "owner";
  const canTransfer = viewerRole === "owner" && member.role === "admin";

  if (!canSetRole) return null;

  return (
    <div className="flex shrink-0 flex-col items-end">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${member.name ?? cohortLabel(member.cohort)} 역할 관리`}
              disabled={pending}
            />
          }
        >
          {pending ? <Spinner /> : <MoreHorizontalIcon />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuGroup>
            <DropdownMenuLabel>역할 변경</DropdownMenuLabel>
            {ASSIGNABLE_ROLES.map((role) => (
              <DropdownMenuItem
                key={role}
                disabled={role === member.role || pending}
                onClick={() =>
                  void fetcher.submit(
                    {
                      intent: "set-member-role",
                      groupId,
                      memberId: member.membership_id,
                      role,
                    },
                    { method: "post" },
                  )
                }
              >
                {getGroupMemberRoleLabel(role)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          {canTransfer ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setTransferOpen(true)}>
                <ShieldCheckIcon /> 소유권 이전
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <GroupConfirmDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        title="그룹 소유권 이전"
        description={`${member.name ?? cohortLabel(member.cohort)}에게 소유권을 이전할까요? 이전 후 현재 소유자는 관리자가 됩니다.`}
        confirmLabel="소유권 이전"
        pending={pending}
        onConfirm={() => {
          setTransferOpen(false);
          void fetcher.submit(
            {
              intent: "transfer-ownership",
              groupId,
              memberId: member.membership_id,
            },
            { method: "post" },
          );
        }}
      />
      {fetcher.data?.error ? (
        <p
          role="alert"
          className="mt-1 max-w-48 text-right text-xs text-destructive"
        >
          {fetcher.data.error}
        </p>
      ) : null}
    </div>
  );
}

function cohortLabel(cohort: number | null): string {
  return cohort === null ? "기수 없음" : `${cohort}기`;
}

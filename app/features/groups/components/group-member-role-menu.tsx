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
  // 고른 역할을 바로 반영하지 않고 확인을 받는다. 드롭다운 항목은 서로 붙어 있어서 잘못 누르기
  // 쉬운데, 관리자 승격은 이후 소유자만 되돌릴 수 있다.
  const [pendingRole, setPendingRole] = useState<GroupMemberRole | null>(null);
  const pending = fetcher.state !== "idle";
  // 관리자는 새 매니저와 새 관리자를 세울 수 있지만 이미 관리자인 사람은 건드리지 못한다.
  // 관리자끼리 서로 강등할 수 있으면 둘이 번갈아 내리는 상황을 그룹이 스스로 정리하지 못한다.
  // 소유자의 역할은 소유권 이전으로만 바뀐다. 매니저 이하는 아무 역할도 바꾸지 못한다.
  const canSetRole =
    member.role !== "owner" &&
    (viewerRole === "owner" ||
      (viewerRole === "admin" && member.role !== "admin"));
  const canTransfer = viewerRole === "owner" && member.role === "admin";
  // 관리자를 세우는 것도 소유자만 한다. 관리자가 관리자를 만들 수 있으면 늘리는 것은 아무나,
  // 줄이는 것은 소유자만 할 수 있어서 관리자 수가 한 방향으로만 늘어난다.
  const assignableRoles = ASSIGNABLE_ROLES.filter(
    (role) => role !== "admin" || viewerRole === "owner",
  );

  if (!canSetRole) return null;

  return (
    <div className="flex shrink-0 flex-col items-end">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${displayName(member)} 역할 관리`}
              disabled={pending}
            />
          }
        >
          {pending ? <Spinner /> : <MoreHorizontalIcon />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuGroup>
            <DropdownMenuLabel>역할 변경</DropdownMenuLabel>
            {assignableRoles.map((role) => (
              <DropdownMenuItem
                key={role}
                disabled={role === member.role || pending}
                onClick={() => setPendingRole(role)}
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
        open={pendingRole !== null}
        onOpenChange={(open) => setPendingRole(open ? pendingRole : null)}
        title={displayName(member)}
        description={
          pendingRole === null ? "" : roleChangeDescription(member, pendingRole)
        }
        confirmLabel="역할 변경"
        confirmVariant={
          pendingRole !== null && isDemotion(member.role, pendingRole)
            ? "destructive"
            : "default"
        }
        pending={pending}
        onConfirm={() => {
          const role = pendingRole;
          setPendingRole(null);
          if (role === null) return;
          void fetcher.submit(
            {
              intent: "set-member-role",
              groupId,
              memberId: member.membership_id,
              role,
            },
            { method: "post" },
          );
        }}
      />
      <GroupConfirmDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        title="그룹 소유권 이전"
        description={`${displayName(member)}에게 소유권을 이전할까요? 이전 후 현재 소유자는 관리자가 됩니다.`}
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

/** 항상 익명 그룹의 명부에는 이름이 없다. 그때는 기수가 그 사람을 가리키는 유일한 이름이다. */
function displayName(member: GroupMember): string {
  return member.name ?? cohortLabel(member.cohort);
}

/** 낮은 쪽이 약한 권한. 강등은 확인 버튼을 위험 동작으로 칠하려고 구분한다. */
const ROLE_RANK: Record<GroupMemberRole, number> = {
  member: 0,
  manager: 1,
  admin: 2,
  owner: 3,
};

function isDemotion(from: GroupMemberRole, to: GroupMemberRole): boolean {
  return ROLE_RANK[to] < ROLE_RANK[from];
}

function roleChangeDescription(
  member: GroupMember,
  next: GroupMemberRole,
): string {
  // 익명 명부에는 이름이 없어 기수가 곧 호칭이다. "30기님"은 어색하므로 그대로 쓴다.
  const who = member.name ? `${member.name}님` : cohortLabel(member.cohort);
  // 역할 이름(소유자·관리자·매니저·멤버)이 모두 모음으로 끝나 조사는 항상 `로`다.
  const base = `${who}을 ${getGroupMemberRoleLabel(
    member.role,
  )}에서 ${getGroupMemberRoleLabel(next)}로 바꿀까요?`;
  // 관리자를 세우고 내리는 일은 소유자만 한다. 승격시키는 소유자에게 그 뒤로 이 사람의 역할을
  // 건드릴 수 있는 사람이 자기뿐이라는 것을 미리 알린다.
  if (next === "admin") {
    return `${base} 이후 이 관리자의 역할은 소유자만 바꿀 수 있습니다.`;
  }
  return base;
}

import { Settings2Icon } from "lucide-react";

import { BasicInfoCard } from "~/features/groups/components/group-basic-settings";
import { DangerSettings } from "~/features/groups/components/group-danger-settings";
import { InviteSettings } from "~/features/groups/components/group-invite-settings";
import { GroupMediaSettings } from "~/features/groups/components/group-media-settings";
import { PolicySettings } from "~/features/groups/components/group-policy-settings";
import type { GroupDetail, GroupInvite } from "~/features/groups/model/types";
import { CategoryManager, type GroupCategory } from "~/features/posts";
import { Badge } from "~/shared/ui/badge";

export function GroupSettings({
  group,
  categories,
  invite = null,
  canDeleteOfficial = false,
}: {
  group: GroupDetail;
  categories: GroupCategory[];
  invite?: GroupInvite | null;
  canDeleteOfficial?: boolean;
}) {
  const canManage =
    group.member_role === "owner" || group.member_role === "admin";
  const canCurate = canManage || group.member_role === "manager";

  return (
    <div className="flex flex-col gap-4">
      <header className="px-4 pt-1 md:px-1">
        <div className="flex items-center gap-2">
          <Settings2Icon aria-hidden="true" className="size-5" />
          <h2 className="text-lg font-semibold tracking-tight">그룹 설정</h2>
          <Badge variant="secondary">
            {canDeleteOfficial && group.kind === "official"
              ? "앱 관리자"
              : group.member_role === "owner"
                ? "소유자"
                : group.member_role === "admin"
                  ? "관리자"
                  : "매니저"}
          </Badge>
        </div>
      </header>

      {canManage ? (
        <>
          <GroupMediaSettings group={group} />
          <BasicInfoCard group={group} />
        </>
      ) : null}

      {/* 매니저에게는 이 카드 하나만 보인다. 그래서 canManage 블록 밖에 있다. */}
      {canCurate ? (
        <CategoryManager groupId={group.group_id} categories={categories} />
      ) : null}

      {canManage ? (
        <>
          <PolicySettings group={group} />
          <InviteSettings group={group} invite={invite} />
        </>
      ) : null}

      {/* 되돌릴 수 없는 동작이라 맨 아래에 따로 둔다. */}
      <DangerSettings group={group} canDeleteOfficial={canDeleteOfficial} />
    </div>
  );
}

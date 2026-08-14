import { Settings2Icon } from "lucide-react";

import { BasicInfoCard } from "~/features/groups/components/group-basic-settings";
import { GroupMediaSettings } from "~/features/groups/components/group-media-settings";
import { PolicySettings } from "~/features/groups/components/group-policy-settings";
import type { GroupDetail } from "~/features/groups/model/types";
import { CategoryManager, type GroupCategory } from "~/features/posts";
import { Badge } from "~/shared/ui/badge";

export function GroupSettings({
  group,
  categories,
}: {
  group: GroupDetail;
  categories: GroupCategory[];
}) {
  const canManage =
    group.member_role === "owner" || group.member_role === "admin";

  return (
    <div className="flex flex-col gap-4">
      <header className="px-4 pt-1 md:px-1">
        <div className="flex items-center gap-2">
          <Settings2Icon aria-hidden="true" className="size-5" />
          <h2 className="text-lg font-semibold tracking-tight">그룹 설정</h2>
          <Badge variant="secondary">
            {group.member_role === "owner"
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
          <PolicySettings group={group} />
        </>
      ) : null}

      <CategoryManager groupId={group.group_id} categories={categories} />
    </div>
  );
}

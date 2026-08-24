import { UsersIcon } from "lucide-react";
import { Link } from "react-router";

import { GroupAvatar } from "~/features/groups/components/group-avatar";
import { GroupMembershipAction } from "~/features/groups/components/group-membership-action";
import type {
  GroupIdentityPolicy,
  GroupJoinPolicy,
  GroupMembershipState,
} from "~/features/groups/model/types";

export function GroupDiscoverCard({
  group,
  profileId,
}: {
  group: {
    group_id: string;
    slug: string;
    name: string;
    description: string;
    join_policy: GroupJoinPolicy;
    identity_policy: GroupIdentityPolicy;
    icon_path: string | null;
    cover_path: string | null;
    member_count: number;
    membership_state: GroupMembershipState;
  };
  profileId: number;
}) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="aspect-[4/1] w-full overflow-hidden bg-gradient-to-br from-primary/30 to-primary/5">
        {group.cover_path ? (
          <img
            src={group.cover_path}
            alt=""
            width={800}
            height={200}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-4 pt-0">
        <GroupAvatar
          name={group.name}
          iconPath={group.icon_path}
          className="-mt-7 mb-2 size-14 border-4 border-card text-lg"
        />
        <h3 className="line-clamp-2 text-base font-semibold">
          <Link
            to={`/groups/${group.slug}`}
            className="rounded-sm outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring"
          >
            {group.name}
          </Link>
        </h3>
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
          {group.description || "아직 그룹 설명이 없습니다."}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <UsersIcon aria-hidden className="size-3.5" />
            멤버 {group.member_count.toLocaleString("ko-KR")}명
          </p>
        </div>
        <div className="mt-auto pt-4">
          <GroupMembershipAction
            group={group}
            profileId={profileId}
            fullWidth
          />
        </div>
      </div>
    </article>
  );
}

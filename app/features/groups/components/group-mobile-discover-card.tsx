import { Link } from "react-router";

import { GroupAvatar } from "~/features/groups/components/group-avatar";
import { GroupMembershipAction } from "~/features/groups/components/group-membership-action";
import { getGroupJoinPolicyLabel } from "~/features/groups/model/format";
import type { DiscoverGroupItem } from "~/features/groups/model/types";

export function GroupMobileDiscoverCard({
  group,
  profileId,
}: {
  group: DiscoverGroupItem;
  profileId: number;
}) {
  return (
    <article
      data-slot="group-mobile-discover-card"
      className="relative min-w-0 overflow-hidden rounded-xl border bg-card"
    >
      <div className="aspect-[3/1] overflow-hidden bg-gradient-to-br from-primary/30 to-primary/5">
        {group.cover_path ? (
          <img
            src={group.cover_path}
            alt=""
            width={480}
            height={160}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col px-2.5 pb-3">
        <GroupAvatar
          name={group.name}
          iconPath={group.icon_path}
          className="-mt-5 mb-1.5 size-10 border-3 border-card text-sm"
        />
        <h3 className="line-clamp-2 text-sm leading-5 font-semibold">
          <Link
            to={`/groups/${group.slug}`}
            className="after:absolute after:inset-0"
          >
            {group.name}
          </Link>
        </h3>
        <p className="mt-2 text-xs text-muted-foreground tabular-nums">
          {getGroupJoinPolicyLabel(group.join_policy)} · 멤버{" "}
          {group.member_count.toLocaleString("ko-KR")}명
        </p>
        <div className="relative z-10 mt-2.5">
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

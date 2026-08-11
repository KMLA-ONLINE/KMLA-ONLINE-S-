import { Link } from "react-router";

import { GroupAvatar } from "~/features/groups/components/group-avatar";
import type { DiscoverGroupItem } from "~/features/groups/model/types";
import { Badge } from "~/shared/ui/badge";

export function GroupMobileDiscoverCard({
  group,
}: {
  group: DiscoverGroupItem;
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
        <h3 className="line-clamp-2 min-h-10 text-sm leading-5 font-semibold">
          <Link
            to={`/groups/${group.slug}`}
            className="after:absolute after:inset-0"
          >
            {group.name}
          </Link>
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {group.join_policy === "request" ? (
            <Badge variant="secondary">승인 후 가입</Badge>
          ) : (
            <span>즉시 가입</span>
          )}
          <span className="tabular-nums">
            멤버 {group.member_count.toLocaleString("ko-KR")}명
          </span>
        </div>
      </div>
    </article>
  );
}

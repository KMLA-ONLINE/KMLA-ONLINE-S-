import { BadgeCheckIcon, Globe2Icon, LockIcon } from "lucide-react";

import { GroupAvatar } from "~/features/groups/components/group-avatar";
import { GroupDetailActions } from "~/features/groups/components/group-detail-actions";
import type { GroupDetail } from "~/features/groups/model/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/shared/ui/tooltip";

export function GroupDetailHero({
  group,
  profileId,
  isTeacher,
  onSelectMembers,
  onSelectSettings,
  onSelectReports,
}: {
  group: GroupDetail;
  profileId: number;
  isTeacher: boolean;
  onSelectMembers: () => void;
  onSelectSettings: () => void;
  onSelectReports: () => void;
}) {
  const isMember = group.membership_state === "member";
  const isPrivate = group.join_policy === "invite_only";
  const VisibilityIcon = isPrivate ? LockIcon : Globe2Icon;

  return (
    <section className="overflow-hidden border-0 bg-card sm:rounded-xl sm:border">
      <div className="relative aspect-[4/1] w-full overflow-hidden bg-gradient-to-br from-primary/30 to-primary/5">
        {group.cover_path ? (
          <img
            src={group.cover_path}
            alt=""
            width={1200}
            height={300}
            fetchPriority="high"
            className="size-full object-cover"
          />
        ) : null}
      </div>

      <div className="flex items-start gap-5 p-4 py-2 md:py-4">
        <GroupAvatar
          name={group.name}
          iconPath={group.icon_path}
          className="hidden size-16 shrink-0 rounded-xl text-xl sm:flex sm:size-20"
        />
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-bold">{group.name}</h1>
            {group.kind === "official" ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      role="img"
                      aria-label="공식 그룹"
                      className="inline-flex shrink-0 cursor-default"
                    />
                  }
                >
                  <BadgeCheckIcon aria-hidden className="size-6 text-primary" />
                </TooltipTrigger>
                <TooltipContent>공식 그룹입니다</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <VisibilityIcon aria-hidden className="size-3.5 shrink-0" />
            {isPrivate ? "비공개 그룹" : "공개 그룹"} ·{" "}
            {isMember ? (
              <button
                type="button"
                className="hover:underline md:cursor-default md:hover:no-underline"
                onClick={onSelectMembers}
              >
                멤버 {group.member_count.toLocaleString("ko-KR")}명
              </button>
            ) : (
              `멤버 ${group.member_count.toLocaleString("ko-KR")}명`
            )}
          </p>
          {group.identity_policy === "always_anonymous" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              게시물과 댓글이 모두 익명으로 표시됩니다.
            </p>
          ) : null}
        </div>
        <GroupDetailActions
          group={group}
          profileId={profileId}
          isTeacher={isTeacher}
          onSelectSettings={onSelectSettings}
          onSelectReports={onSelectReports}
        />
      </div>
    </section>
  );
}

import {
  CompassIcon,
  PlusIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react";
import { Link } from "react-router";

import { GroupSummaryCard } from "~/features/groups/components/group-summary-card";
import type { GroupHomeItem } from "~/features/groups/model/types";
import { Button } from "~/shared/ui/button";

export function GroupHomeScreen({
  groups,
  isTeacher,
  profileId,
}: {
  groups: GroupHomeItem[];
  isTeacher: boolean;
  profileId: number;
}) {
  const officialGroups = groups.filter((group) => group.section === "official");
  const myGroups = groups.filter((group) => group.section === "mine");
  const popularGroups = groups.filter((group) => group.section === "popular");

  return (
    <div className="flex flex-col gap-10 px-4 py-6 md:px-0 md:py-8">
      <section className="relative overflow-hidden rounded-2xl border bg-card p-6 shadow-xs md:p-8">
        <div className="absolute -top-12 -right-10 size-40 rounded-full bg-primary/10 blur-2xl" />
        <div className="relative max-w-xl">
          <p className="mb-2 text-sm font-medium text-primary">KMLA GROUPS</p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            함께할 사람과 공간을 찾으세요
          </h1>
          <p className="mt-3 leading-7 text-muted-foreground">
            공식 소식을 확인하고, 관심사가 같은 구성원과 새로운 그룹을 만들어
            보세요.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {!isTeacher ? (
              <Button render={<Link to="/groups/discover" />}>
                <CompassIcon data-icon="inline-start" />
                그룹 찾기
              </Button>
            ) : null}
            <Button variant="outline" render={<Link to="/groups/create" />}>
              <PlusIcon data-icon="inline-start" />
              그룹 만들기
            </Button>
          </div>
        </div>
      </section>

      {!isTeacher ? (
        <GroupSection
          icon={<ShieldCheckIcon aria-hidden />}
          title="공식 그룹"
          description="학교가 운영하는 공식 공간입니다."
          groups={officialGroups}
          profileId={profileId}
          showPin
        />
      ) : null}

      <GroupSection
        icon={<UsersIcon aria-hidden />}
        title="내 비공식 그룹"
        description={
          isTeacher
            ? "직접 만들었거나 초대를 받아 참여한 그룹입니다."
            : "참여 중인 비공식 그룹입니다."
        }
        groups={myGroups}
        profileId={profileId}
        showPin
        emptyText="아직 참여 중인 비공식 그룹이 없습니다."
      />

      {!isTeacher ? (
        <GroupSection
          icon={<CompassIcon aria-hidden />}
          title="지금 많이 찾는 그룹"
          description="아직 가입하지 않은 공개 그룹 중 멤버가 많은 곳입니다."
          groups={popularGroups}
          profileId={profileId}
          emptyText="추천할 공개 그룹이 아직 없습니다."
        />
      ) : null}
    </div>
  );
}

function GroupSection({
  icon,
  title,
  description,
  groups,
  profileId,
  showPin = false,
  emptyText = "표시할 그룹이 없습니다.",
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  groups: GroupHomeItem[];
  profileId: number;
  showPin?: boolean;
  emptyText?: string;
}) {
  const headingId = `group-section-${title.replaceAll(" ", "-")}`;

  return (
    <section aria-labelledby={headingId}>
      <div className="mb-4 flex items-start gap-3">
        <div className="mt-0.5 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-5">
          {icon}
        </div>
        <div>
          <h2 id={headingId} className="text-lg font-semibold">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {groups.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((group) => (
            <GroupSummaryCard
              key={`${group.section}-${group.group_id}`}
              group={group}
              profileId={profileId}
              showPin={showPin}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed px-5 py-10 text-center text-sm text-muted-foreground">
          {emptyText}
        </div>
      )}
    </section>
  );
}

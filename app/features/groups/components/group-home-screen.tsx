import { CirclePlusIcon } from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { GroupSummaryCard } from "~/features/groups/components/group-summary-card";
import type { GroupHomeItem } from "~/features/groups/model/types";
import { Button } from "~/shared/ui/button";
import { cn } from "~/shared/lib/utils";

type GroupTab = "official" | "unofficial";

export function GroupHomeScreen({
  groups,
  isTeacher,
  profileId,
}: {
  groups: GroupHomeItem[];
  isTeacher: boolean;
  profileId: number;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: GroupTab =
    searchParams.get("tab") === "unofficial" ? "unofficial" : "official";
  const officialGroups = groups.filter((group) => group.section === "official");
  const myGroups = groups.filter((group) => group.section === "mine");
  const popularGroups = groups.filter((group) => group.section === "popular");

  if (isTeacher) {
    return (
      <div className="mx-auto flex w-full flex-col gap-6 px-4 pb-5 md:px-0 md:py-0">
        <ScreenHeader actionLabel="비공식 그룹 만들기" />
        <GroupRows
          title="내 그룹"
          groups={myGroups}
          profileId={profileId}
          emptyText="아직 내 그룹이 없습니다."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full flex-col gap-5 px-1 pb-5 md:px-0 md:py-0">
      <ScreenHeader actionLabel={tab === "unofficial" ? "그룹 만들기" : null} />

      <nav className="flex items-center gap-1 border-b" aria-label="그룹 종류">
        {(["official", "unofficial"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              if (item === "official") next.delete("tab");
              else next.set("tab", item);
              setSearchParams(next, { preventScrollReset: true });
            }}
            aria-current={tab === item ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              tab === item
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item === "official" ? "공식" : "비공식"}
          </button>
        ))}
      </nav>

      {tab === "official" ? (
        <GroupRows
          groups={officialGroups}
          profileId={profileId}
          emptyText="표시할 공식 그룹이 없습니다."
        />
      ) : (
        <div className="flex flex-col gap-7">
          <GroupRows
            title="내 그룹"
            groups={myGroups}
            profileId={profileId}
            emptyText="아직 참여 중인 비공식 그룹이 없습니다."
          />
          <section
            className="flex flex-col gap-3"
            aria-labelledby="popular-groups-heading"
          >
            <div className="flex items-baseline justify-between gap-2 px-2 md:px-0">
              <h2 id="popular-groups-heading" className="text-sm font-semibold">
                인기 그룹
              </h2>
              <Link
                to="/groups/discover"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                전체 보기 →
              </Link>
            </div>
            {popularGroups.length > 0 ? (
              <div className="hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-3">
                {popularGroups.map((group) => (
                  <GroupSummaryCard
                    key={group.group_id}
                    group={group}
                    profileId={profileId}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                더 들어갈 공개 그룹이 없습니다.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ScreenHeader({ actionLabel }: { actionLabel: string | null }) {
  return (
    <header className="hidden items-center justify-between gap-3 md:flex">
      <h1 className="text-2xl font-semibold">그룹</h1>
      {actionLabel ? (
        <Button size="sm" render={<Link to="/groups/create" />}>
          <CirclePlusIcon data-icon="inline-start" aria-hidden />
          {actionLabel}
        </Button>
      ) : null}
    </header>
  );
}

function GroupRows({
  title,
  groups,
  profileId,
  emptyText,
}: {
  title?: string;
  groups: GroupHomeItem[];
  profileId: number;
  emptyText: string;
}) {
  return (
    <section className="flex flex-col gap-3" aria-label={title ?? "공식 그룹"}>
      {title ? (
        <h2 className="pl-2 text-sm font-semibold md:pl-0">
          {title}{" "}
          <span className="font-normal text-muted-foreground">
            {groups.length}
          </span>
        </h2>
      ) : null}
      {groups.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {groups.map((group) => (
            <GroupSummaryCard
              key={group.group_id}
              group={group}
              profileId={profileId}
              variant="row"
              showPin
            />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {emptyText}
        </p>
      )}
    </section>
  );
}

import { ChevronRightIcon, CirclePlusIcon, SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { GroupSummaryRow } from "~/features/groups/components/group-summary-row";
import type { GroupHomeItem } from "~/features/groups/model/types";
import { Button } from "~/shared/ui/button";
import { cn } from "~/shared/lib/utils";

type GroupTab = "official" | "unofficial";
const GROUP_HOME_TAB_STORAGE_KEY = "kmla-online:group-home-tab";

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
  const requestedTab = searchParams.get("tab");
  const [savedTab, setSavedTab] = useState<GroupTab>(() =>
    typeof window !== "undefined" &&
    sessionStorage.getItem(GROUP_HOME_TAB_STORAGE_KEY) === "unofficial"
      ? "unofficial"
      : "official",
  );
  const tab: GroupTab =
    requestedTab === "unofficial"
      ? "unofficial"
      : requestedTab === "official"
        ? "official"
        : savedTab;
  const officialGroups = groups.filter((group) => group.section === "official");
  const myGroups = groups.filter((group) => group.section === "mine");

  useEffect(() => {
    sessionStorage.setItem(GROUP_HOME_TAB_STORAGE_KEY, tab);
  }, [tab]);

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
              setSavedTab(item);
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
        <div className="flex flex-col gap-4">
          <GroupRows
            title="내 그룹"
            groups={myGroups}
            profileId={profileId}
            emptyText="아직 참여 중인 비공식 그룹이 없습니다."
          />
          <DiscoverEntry />
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
        <Button
          size="sm"
          nativeButton={false}
          render={<Link to="/groups/create" />}
        >
          <CirclePlusIcon data-icon="inline-start" aria-hidden />
          {actionLabel}
        </Button>
      ) : null}
    </header>
  );
}

function DiscoverEntry() {
  return (
    <Link
      to="/groups/discover"
      className="mt-10 flex items-center gap-3 rounded-xl border border-dashed px-3 py-2.5 transition-colors hover:bg-muted/40"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground">
        <SearchIcon aria-hidden className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">
          비공식 그룹 찾아보기
        </span>
      </span>
      <ChevronRightIcon
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
      />
    </Link>
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
        <div className="grid gap-1.5 md:grid-cols-2 md:gap-2">
          {groups.map((group) => (
            <GroupSummaryRow
              key={group.group_id}
              group={group}
              profileId={profileId}
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

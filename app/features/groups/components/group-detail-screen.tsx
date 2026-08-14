import {
  Globe2Icon,
  LandmarkIcon,
  LockIcon,
  MessageSquareTextIcon,
  UsersIcon,
} from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { GroupDetailHero } from "~/features/groups/components/group-detail-hero";
import { GroupMembersPanel } from "~/features/groups/components/group-members-panel";
import { GroupSettings } from "~/features/groups/components/group-settings";
import {
  getGroupIdentityPolicyLabel,
  getGroupJoinPolicyLabel,
  getGroupPostingPolicyLabel,
} from "~/features/groups/model/format";
import type {
  GroupDetail,
  GroupJoinRequest,
  GroupMemberPage,
} from "~/features/groups/model/types";
import {
  GroupPostsPanel,
  type GroupCategory,
  type GroupPostPage,
} from "~/features/posts";
import { cn } from "~/shared/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";

type GroupTab = "posts" | "members" | "settings";

const GROUP_TABS: {
  id: GroupTab;
  label: string;
}[] = [
  { id: "posts", label: "게시물" },
  { id: "members", label: "멤버" },
  { id: "settings", label: "그룹 설정" },
];

export function GroupDetailScreen({
  group,
  profileId,
  isTeacher,
  categories = [],
  posts = { posts: [], nextCursor: null },
  memberPage,
  joinRequests = [],
}: {
  group: GroupDetail;
  profileId: number;
  isTeacher: boolean;
  categories?: GroupCategory[];
  posts?: GroupPostPage;
  memberPage?: GroupMemberPage;
  joinRequests?: GroupJoinRequest[];
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const isMember = group.membership_state === "member";
  const isPrivate = group.join_policy === "invite_only";
  const VisibilityIcon = isPrivate ? LockIcon : Globe2Icon;
  const canManage =
    group.member_role === "owner" || group.member_role === "admin";
  const canCurate = canManage || group.member_role === "manager";
  const canCreatePost =
    isMember && (group.posting_policy === "members" || canCurate);
  const canViewMembers = isMember;
  const requestedTab = searchParams.get("tab");
  const tab: GroupTab =
    (requestedTab === "members" && canViewMembers) ||
    (requestedTab === "settings" && canCurate)
      ? requestedTab
      : "posts";
  const visibleTabs = GROUP_TABS.filter(
    (item) =>
      (item.id !== "members" || canViewMembers) &&
      (item.id !== "settings" || canCurate),
  );

  const setTab = (nextTab: GroupTab) => {
    const next = new URLSearchParams(searchParams);
    if (nextTab === "posts") next.delete("tab");
    else next.set("tab", nextTab);
    setSearchParams(next, { preventScrollReset: true });
  };

  return (
    <div className="pb-10 md:pt-0">
      <GroupDetailHero
        group={group}
        profileId={profileId}
        isTeacher={isTeacher}
        onSelectMembers={() => setTab("members")}
        onSelectSettings={() => setTab("settings")}
      />

      <nav
        className="mx-2 mt-1 hidden items-center gap-1 border-b md:flex"
        aria-label="그룹 메뉴"
      >
        {visibleTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === item.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="grid gap-6 py-3 md:py-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 lg:order-1">
          {tab === "posts" ? (
            <div className="flex flex-col gap-3">
              {canCreatePost ? <WritePostRow slug={group.slug} /> : null}
              <GroupPostsPanel
                key={posts.posts
                  .map((post) => `${post.post_id}:${post.is_pinned}`)
                  .join("|")}
                groupId={group.group_id}
                slug={group.slug}
                categories={categories}
                initialPage={posts}
              />
            </div>
          ) : tab === "members" ? (
            memberPage ? (
              <GroupMembersPanel
                groupId={group.group_id}
                identityPolicy={group.identity_policy}
                viewerRole={group.member_role}
                initialPage={memberPage}
                memberCount={group.member_count}
                joinRequests={joinRequests}
              />
            ) : (
              <EmptyTabCard
                icon={<UsersIcon aria-hidden />}
                title={`멤버 ${group.member_count.toLocaleString("ko-KR")}`}
                description="멤버 명부를 불러오는 중입니다."
              />
            )
          ) : (
            <GroupSettings group={group} categories={categories} />
          )}
        </div>

        <aside className="hidden lg:order-2 lg:block">
          <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 lg:sticky lg:top-4">
            <h2 className="text-sm font-semibold">그룹 정보</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {group.description || "아직 그룹 설명이 없습니다."}
            </p>
            <InfoRow icon={<LandmarkIcon />}>
              {group.kind === "official" ? "공식 그룹" : "비공식 그룹"}
            </InfoRow>
            <InfoRow icon={<VisibilityIcon />}>
              {isPrivate ? "비공개" : "공개"} ·{" "}
              {getGroupJoinPolicyLabel(group.join_policy)}
            </InfoRow>
            <InfoRow icon={<UsersIcon />}>
              멤버 {group.member_count.toLocaleString("ko-KR")}명
            </InfoRow>
            <InfoRow icon={<MessageSquareTextIcon />}>
              {getGroupIdentityPolicyLabel(group.identity_policy)} ·{" "}
              {getGroupPostingPolicyLabel(group.posting_policy)}
            </InfoRow>
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * 게시물 스택의 첫 카드처럼 보이는 글쓰기 진입점. 카드와 같은 프레이밍(모바일은 풀블리드,
 * `md:`부터 테두리 있는 카드)을 그대로 쓰는 것이 핵심이다 — 별개의 버튼으로 보이면 피드
 * 상단에 관련 없는 컨트롤이 하나 얹힌 것처럼 읽힌다.
 */
function WritePostRow({ slug }: { slug: string }) {
  return (
    <Link
      to={`/groups/${slug}/posts/new`}
      className="group flex items-center gap-3 overflow-hidden rounded-none border-b-2 border-foreground/20 bg-card px-4 py-3 md:rounded-xl md:border md:border-border md:px-3 md:py-2.5"
    >
      <div
        className="size-9 shrink-0 rounded-full border bg-muted"
        aria-hidden="true"
      />
      <span className="flex-1 rounded-full bg-muted px-4 py-2 text-sm text-muted-foreground transition-[filter] group-hover:brightness-95">
        글쓰기…
      </span>
    </Link>
  );
}

function EmptyTabCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="h-fit rounded-none border-x-0 md:rounded-xl md:border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 [&_svg]:size-5">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
          {description}
        </div>
      </CardContent>
    </Card>
  );
}

function InfoRow({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground [&_svg]:size-4">
      {icon}
      <span>{children}</span>
    </div>
  );
}

import {
  FlagIcon,
  Globe2Icon,
  LandmarkIcon,
  LockIcon,
  MessageSquareTextIcon,
  UsersIcon,
} from "lucide-react";
import { useLocation, useNavigation, useSearchParams } from "react-router";

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
  GroupInvite,
  GroupJoinRequest,
  GroupMemberPage,
} from "~/features/groups/model/types";
import { GroupPostReportsPanel } from "~/features/posts/components/group-post-reports-panel";
import type { GroupPostReportSummaryPage } from "~/features/posts/data/group-reports";
import {
  GroupPostSearchDialog,
  GroupPostsPanel,
  PostWriteRow,
  type GroupCategory,
  type GroupPostPage,
} from "~/features/posts";
import { cn } from "~/shared/lib/utils";
import { useDelayedPending } from "~/shared/hooks/use-delayed-pending";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";

type GroupTab = "posts" | "members" | "settings" | "reports";

const GROUP_TABS: {
  id: GroupTab;
  label: string;
}[] = [
  { id: "posts", label: "게시물" },
  { id: "members", label: "멤버" },
  { id: "settings", label: "그룹 설정" },
  { id: "reports", label: "신고" },
];

export function GroupDetailScreen({
  group,
  profileId,
  viewerName,
  viewerAvatarUrl,
  isTeacher,
  categories = [],
  posts = { posts: [], nextCursor: null },
  memberPage,
  joinRequests = [],
  invite = null,
  reportPage,
}: {
  group: GroupDetail;
  profileId: number;
  viewerName: string | null;
  viewerAvatarUrl: string | null;
  isTeacher: boolean;
  categories?: GroupCategory[];
  posts?: GroupPostPage;
  memberPage?: GroupMemberPage;
  joinRequests?: GroupJoinRequest[];
  invite?: GroupInvite | null;
  reportPage?: GroupPostReportSummaryPage;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigation = useNavigation();
  const isMember = group.membership_state === "member";
  const isPrivate = group.join_policy === "invite_only";
  const VisibilityIcon = isPrivate ? LockIcon : Globe2Icon;
  const canManage =
    group.member_role === "owner" || group.member_role === "admin";
  const canCurate = canManage || group.member_role === "manager";
  const canCreatePost =
    isMember && (group.posting_policy === "members" || canCurate);
  const canViewMembers = isMember;
  const tabNavigationPending =
    navigation.state === "loading" &&
    navigation.location?.pathname === location.pathname &&
    navigation.location.search !== location.search;
  const showTabSkeleton = useDelayedPending(tabNavigationPending);
  const visibleSearchParams =
    showTabSkeleton && navigation.location
      ? new URLSearchParams(navigation.location.search)
      : searchParams;
  const requestedTab = visibleSearchParams.get("tab");
  const tab: GroupTab =
    (requestedTab === "members" && canViewMembers) ||
    (requestedTab === "settings" && canCurate) ||
    (requestedTab === "reports" && canCurate)
      ? requestedTab
      : "posts";
  const visibleTabs = GROUP_TABS.filter(
    (item) =>
      (item.id !== "members" || canViewMembers) &&
      (item.id !== "settings" || canCurate) &&
      (item.id !== "reports" || canCurate),
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
        onSelectPosts={() => setTab("posts")}
        onSelectMembers={() => setTab("members")}
        onSelectSettings={() => setTab("settings")}
        onSelectReports={() => setTab("reports")}
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
          {showTabSkeleton ? (
            <GroupTabSkeleton tab={tab} />
          ) : tab === "posts" ? (
            <div className="flex flex-col md:gap-3">
              {canCreatePost ? (
                <PostWriteRow
                  to={`/groups/${group.slug}/posts/new`}
                  viewerName={viewerName}
                  viewerAvatarUrl={viewerAvatarUrl}
                />
              ) : null}
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
          ) : tab === "settings" ? (
            <GroupSettings
              group={group}
              categories={categories}
              invite={invite}
            />
          ) : reportPage ? (
            <GroupPostReportsPanel
              groupId={group.group_id}
              slug={group.slug}
              initialPage={reportPage}
              canModerate={canManage}
            />
          ) : (
            <EmptyTabCard
              icon={<FlagIcon aria-hidden />}
              title="신고"
              description="신고 목록을 불러오는 중입니다."
            />
          )}
        </div>

        <aside className="hidden lg:order-2 lg:block">
          <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 lg:sticky lg:top-4">
            <h2 className="text-sm font-semibold">그룹 정보</h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {group.description}
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

      {/* 검색 버튼은 모바일 헤더와 데스크톱 액션 두 곳에 있지만 검색창은 여기 하나뿐이다.
          열림 상태가 URL에 있으므로 두 곳이 각자 그리면 같은 검색창이 두 장 열린다. */}
      {isMember ? (
        <GroupPostSearchDialog groupId={group.group_id} slug={group.slug} />
      ) : null}
    </div>
  );
}

function GroupTabSkeleton({ tab }: { tab: GroupTab }) {
  const rows = tab === "members" ? 6 : tab === "posts" ? 3 : 4;

  return (
    <section
      aria-busy="true"
      aria-label={`${GROUP_TABS.find((item) => item.id === tab)?.label ?? "그룹"} 탭을 불러오는 중`}
      className="space-y-3 px-4 md:px-0"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="space-y-3 rounded-xl border bg-card p-4">
          <div className="h-4 w-2/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-3 w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
      ))}
      <span className="sr-only" aria-live="polite">
        그룹 탭 내용을 불러오는 중입니다.
      </span>
    </section>
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

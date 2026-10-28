import { useState } from "react";
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
  isPrivateJoinPolicy,
} from "~/features/groups/model/format";
import type {
  GroupDetail,
  GroupInvite,
  GroupJoinRequest,
  GroupMemberPage,
} from "~/features/groups/model/types";
import { GroupPostReportsPanel } from "~/features/posts/components/group/group-post-reports-panel";
import type { GroupPostReportSummaryPage } from "~/features/posts/data/group-reports";
import {
  AnonymousActivityRestrictionNotice,
  GroupPostSearchDialog,
  GroupPostsPanel,
  PostListSkeleton,
  PostWriteRow,
  type GroupCategory,
  type GroupPostPage,
  type AnonymousActivityRestriction,
} from "~/features/posts";
import { Deferred } from "~/shared/components/deferred";
import { cn } from "~/shared/lib/utils";
import { useDelayedPending } from "~/shared/hooks/use-delayed-pending";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";
import { PendingRegion, Skeleton } from "~/shared/ui/skeleton";

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
  canDeleteOfficial = false,
  categories = [],
  posts = { posts: [], nextCursor: null },
  memberPage,
  joinRequests = [],
  invite = null,
  reportPage,
  anonymousActivityRestriction = null,
}: {
  group: GroupDetail;
  profileId: number;
  viewerName: string | null;
  viewerAvatarUrl: string | null;
  isTeacher: boolean;
  canDeleteOfficial?: boolean;
  categories?: GroupCategory[];
  /**
   * 자식 route로 바로 들어왔을 때는 loader가 기다리지 않고 목록 칸의 카테고리와 함께 promise째
   * 넘긴다. null은 불러오기 실패다.
   */
  posts?:
    | GroupPostPage
    | Promise<{ page: GroupPostPage; categories: GroupCategory[] } | null>;
  memberPage?: GroupMemberPage;
  joinRequests?: GroupJoinRequest[];
  invite?: GroupInvite | null;
  reportPage?: GroupPostReportSummaryPage;
  anonymousActivityRestriction?: AnonymousActivityRestriction | null;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  // 고정 섹션 접힘은 그룹별로 이 화면이 든다. 목록 패널은 삭제 뒤 key가 바뀌어 다시 마운트되므로
  // 거기 두면 카드 메뉴에서 지우는 순간 캐러셀이 다시 펼쳐진다. 다른 그룹으로 가면 다시 펼쳐진다.
  const [pinnedCollapsedFor, setPinnedCollapsedFor] = useState<string | null>(
    null,
  );
  const location = useLocation();
  const navigation = useNavigation();
  const isMember = group.membership_state === "member";
  const isPrivate = isPrivateJoinPolicy(group.join_policy);
  const VisibilityIcon = isPrivate ? LockIcon : Globe2Icon;
  const canManage =
    group.member_role === "owner" || group.member_role === "admin";
  const canCurate = canManage || group.member_role === "manager";
  const canAccessSettings =
    canCurate || (canDeleteOfficial && group.kind === "official");
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
    (requestedTab === "settings" && canAccessSettings) ||
    (requestedTab === "reports" && canCurate)
      ? requestedTab
      : "posts";
  const visibleTabs = GROUP_TABS.filter(
    (item) =>
      (item.id !== "members" || canViewMembers) &&
      (item.id !== "settings" || canAccessSettings) &&
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
        canAccessSettings={canAccessSettings}
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
                <>
                  <PostWriteRow
                    to={`/groups/${group.slug}/posts/new`}
                    viewerName={viewerName}
                    viewerAvatarUrl={viewerAvatarUrl}
                  />
                  {anonymousActivityRestriction ? (
                    <AnonymousActivityRestrictionNotice
                      restriction={anonymousActivityRestriction}
                      className="px-4 text-sm text-muted-foreground md:px-1"
                    />
                  ) : null}
                </>
              ) : null}
              <Deferred
                value={
                  posts instanceof Promise ? posts : { page: posts, categories }
                }
                fallback={<PostListSkeleton />}
              >
                {(content) =>
                  content === null ? (
                    <EmptyTabCard
                      icon={<MessageSquareTextIcon aria-hidden />}
                      title="게시물"
                      description="게시물 목록을 불러오지 못했습니다."
                    />
                  ) : (
                    <KeyedGroupPostsPanel
                      groupId={group.group_id}
                      slug={group.slug}
                      categories={content.categories}
                      initialPage={content.page}
                      pinnedCollapsed={pinnedCollapsedFor === group.group_id}
                      onPinnedCollapsedChange={(collapsed) =>
                        setPinnedCollapsedFor(collapsed ? group.group_id : null)
                      }
                    />
                  )
                }
              </Deferred>
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
                description="멤버 목록을 불러오는 중입니다."
              />
            )
          ) : tab === "settings" ? (
            <GroupSettings
              group={group}
              categories={categories}
              invite={invite}
              canDeleteOfficial={canDeleteOfficial}
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

      {/* 열림 상태가 URL에 있어 검색창은 두 트리거 대신 여기 하나만 그린다. */}
      {isMember ? (
        <GroupPostSearchDialog groupId={group.group_id} slug={group.slug} />
      ) : null}
    </div>
  );
}

type GroupPostsPanelProps = Parameters<typeof GroupPostsPanel>[0];

/** loader가 새 첫 페이지를 주면 더 불러온 페이지를 버리고 다시 시작한다. */
function KeyedGroupPostsPanel(props: GroupPostsPanelProps) {
  return (
    <GroupPostsPanel
      key={props.initialPage.posts.map((post) => post.post_id).join("|")}
      {...props}
    />
  );
}

function GroupTabSkeleton({ tab }: { tab: GroupTab }) {
  const rows = tab === "members" ? 6 : tab === "posts" ? 3 : 4;
  const label = GROUP_TABS.find((item) => item.id === tab)?.label ?? "그룹";

  return (
    <PendingRegion label={`${label} 탭을`} className="space-y-3 px-4 md:px-0">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="space-y-3 rounded-xl border bg-card p-4">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </PendingRegion>
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

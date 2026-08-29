import {
  data,
  Outlet,
  redirect,
  type ShouldRevalidateFunctionArgs,
} from "react-router";

import { defineAppChrome, useAppShell } from "~/features/app-shell";
import {
  cancelGroupJoinRequest,
  approveGroupJoinRequest,
  deleteGroup,
  getGroupErrorMessage,
  getGroupInvite,
  groupKeys,
  GROUP_CONTENT_STALE_TIME,
  GROUP_STALE_TIME,
  GroupDetailMobileHeader,
  GroupDetailScreen,
  issueGroupInvite,
  isGroupAccessQuery,
  joinGroup,
  leaveGroup,
  listGroupJoinRequests,
  listGroupMembers,
  loadGroupDetail,
  requestGroupJoin,
  rejectGroupJoinRequest,
  revokeGroupInvite,
  setGroupPinned,
  setGroupMemberRole,
  transferGroupOwnership,
  updateGroupSettings,
} from "~/features/groups";
import {
  dismissGroupPostReports,
  listGroupPostReportSummaries,
} from "~/features/posts/data/group-reports";
import {
  createGroupCategory,
  createPostListRevalidation,
  deleteGroupCategory,
  deleteGroupPost,
  getPostErrorMessage,
  listGroupCategories,
  listGroupPosts,
  moveGroupCategory,
  setGroupPostPinned,
  updateGroupCategory,
} from "~/features/posts";
import { readPostViewMode } from "~/features/posts/model/view-preference";
import type { Route } from "./+types/detail";
import { feedKeys } from "~/features/feed";
import { getQueryClient } from "~/shared/lib/query-client";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "5xl",
  pullToRefresh: true,
});

/** 게시물 검색 오버레이의 URL 상태. loader가 읽지 않으므로 이것만 바뀌면 다시 읽을 것이 없다. */
const shouldRevalidateList = createPostListRevalidation(["search", "q"]);
const GROUP_PATH_PATTERN = /^\/groups\/[^/]+/;

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  const groupPath = GROUP_PATH_PATTERN.exec(args.currentUrl.pathname)?.[0];
  const isDetailTransition =
    groupPath !== undefined &&
    args.formMethod === undefined &&
    ((args.currentUrl.pathname === groupPath &&
      args.nextUrl.pathname.startsWith(`${groupPath}/posts/`)) ||
      (args.nextUrl.pathname === groupPath &&
        args.currentUrl.pathname.startsWith(`${groupPath}/posts/`)));
  return isDetailTransition ? false : shouldRevalidateList(args);
}

/**
 * `groups/:slug`. 게시물 상세(`posts/:postId`)를 자식으로 가지므로 `<Outlet />`을 그린다 —
 * 게시물을 열어도 그룹 페이지가 언마운트되지 않아 스크롤 위치와 로더 데이터가 유지된다.
 */
export async function clientLoader({
  params,
  request,
}: Route.ClientLoaderArgs) {
  const queryClient = getQueryClient();
  const group = await queryClient.fetchQuery({
    queryKey: groupKeys.detail(params.slug),
    queryFn: () => loadGroupDetail(params.slug),
    staleTime: GROUP_STALE_TIME,
  });
  if (!group) throw new Response("그룹을 찾을 수 없습니다.", { status: 404 });
  if (group.membership_state !== "member") {
    return { group, categories: [], posts: { posts: [], nextCursor: null } };
  }
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const memberTab = searchParams.get("tab") === "members";
  const settingsTab = searchParams.get("tab") === "settings";
  const reportsTab = searchParams.get("tab") === "reports";
  const directPostDetail =
    url.pathname.startsWith(`/groups/${params.slug}/posts/`) &&
    !url.pathname.endsWith("/posts/new") &&
    !url.pathname.endsWith("/edit");
  const postsTab =
    !memberTab && !settingsTab && !reportsTab && !directPostDetail;
  const canModerate =
    group.member_role === "owner" || group.member_role === "admin";
  const canCurate = canModerate || group.member_role === "manager";
  const reportSort =
    searchParams.get("reportSort") === "recent" ? "recent" : "count";
  const [categories, posts, memberPage, joinRequests, invite, reportPage] =
    await Promise.all([
      postsTab || settingsTab
        ? queryClient.fetchQuery({
            queryKey: groupKeys.categories(group.group_id),
            queryFn: () => listGroupCategories(group.group_id),
            staleTime: GROUP_CONTENT_STALE_TIME,
          })
        : Promise.resolve([]),
      postsTab
        ? queryClient.fetchQuery({
            queryKey: groupKeys.posts(group.group_id, null, null),
            queryFn: () =>
              listGroupPosts(group.group_id, {
                hydrateMedia: readPostViewMode() === "card",
              }),
            staleTime: GROUP_CONTENT_STALE_TIME,
          })
        : Promise.resolve({ posts: [], nextCursor: null }),
      memberTab
        ? queryClient.fetchQuery({
            queryKey: groupKeys.members(
              group.group_id,
              searchParams.get("memberQuery") ?? "",
            ),
            queryFn: () =>
              listGroupMembers(
                group.group_id,
                searchParams.get("memberQuery") ?? "",
              ),
          })
        : Promise.resolve(undefined),
      memberTab && canModerate
        ? queryClient.fetchQuery({
            queryKey: groupKeys.joinRequests(group.group_id),
            queryFn: () => listGroupJoinRequests(group.group_id),
          })
        : Promise.resolve([]),
      // 초대 링크는 설정 탭의 운영진에게만 보이고, 다른 사람이 부르면 서버가 42501로 막는다.
      settingsTab && canModerate && group.kind !== "official"
        ? queryClient.fetchQuery({
            queryKey: groupKeys.invite(group.group_id),
            queryFn: () => getGroupInvite(group.group_id),
          })
        : Promise.resolve(null),
      reportsTab && canCurate
        ? queryClient.fetchQuery({
            queryKey: groupKeys.reports(group.group_id, reportSort),
            queryFn: () =>
              listGroupPostReportSummaries(group.group_id, reportSort),
          })
        : Promise.resolve(undefined),
    ]);
  return {
    group,
    categories,
    posts,
    memberPage,
    joinRequests,
    invite,
    reportPage,
  };
}

export async function clientAction({
  params,
  request,
}: Route.ClientActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");
  const groupId = formData.get("groupId");
  const profileId = Number(formData.get("profileId"));
  const postIntent =
    intent === "pin-post" ||
    intent === "delete-post" ||
    intent === "dismiss-report" ||
    intent === "create-category" ||
    intent === "rename-category" ||
    intent === "move-category-up" ||
    intent === "move-category-down" ||
    intent === "delete-category";
  const profileIntent =
    intent === "pin" ||
    intent === "join" ||
    intent === "request" ||
    intent === "cancel-request" ||
    intent === "leave";
  if (
    typeof groupId !== "string" ||
    (profileIntent && !Number.isSafeInteger(profileId))
  ) {
    return data({ error: "그룹을 찾을 수 없습니다." }, { status: 400 });
  }

  try {
    if (intent === "pin-post") {
      const postId = formData.get("postId");
      if (typeof postId !== "string")
        return data({ error: "게시물을 찾을 수 없습니다." }, { status: 400 });
      await setGroupPostPinned(postId, formData.get("pinned") === "true");
    } else if (intent === "delete-post") {
      // 카드의 ⋯ 메뉴에서 지우는 경로. 게시물 상세 route에도 같은 삭제가 있지만 그쪽은
      // 지운 뒤 그룹으로 redirect한다 — 여기서는 이미 그룹에 있으므로 revalidate로 충분하다.
      const postId = formData.get("postId");
      if (typeof postId !== "string")
        return data({ error: "게시물을 찾을 수 없습니다." }, { status: 400 });
      await deleteGroupPost(postId);
    } else if (intent === "dismiss-report") {
      // 신고 무시는 신고 기록을 지우지 않는다. 무시 시점까지의 신고만 처리 완료로 표시하므로
      // 이후 새 신고가 들어오면 목록에 다시 올라온다(기능 명세 §8.15).
      const postId = formData.get("postId");
      if (typeof postId !== "string")
        return data({ error: "게시물을 찾을 수 없습니다." }, { status: 400 });
      await dismissGroupPostReports(postId);
    } else if (intent === "create-category") {
      const rawName = formData.get("name");
      const name = typeof rawName === "string" ? rawName.trim() : "";
      if (!name || Array.from(name).length > 30 || typeof groupId !== "string")
        return data(
          { error: "카테고리 이름은 1자 이상 30자 이하로 입력해 주세요." },
          { status: 400 },
        );
      await createGroupCategory(groupId, name);
    } else if (intent === "rename-category") {
      const categoryId = formData.get("categoryId");
      const rawName = formData.get("name");
      const name = typeof rawName === "string" ? rawName.trim() : "";
      const position = Number(formData.get("position"));
      if (
        typeof categoryId !== "string" ||
        !name ||
        Array.from(name).length > 30 ||
        !Number.isFinite(position)
      )
        return data(
          { error: "카테고리 정보를 다시 확인해 주세요." },
          { status: 400 },
        );
      await updateGroupCategory(categoryId, name, position);
    } else if (
      intent === "move-category-up" ||
      intent === "move-category-down"
    ) {
      const categoryId = formData.get("categoryId");
      if (typeof categoryId !== "string")
        return data(
          { error: "카테고리 순서를 다시 확인해 주세요." },
          { status: 400 },
        );
      await moveGroupCategory(
        categoryId,
        intent === "move-category-up" ? -1 : 1,
      );
    } else if (intent === "delete-category") {
      const categoryId = formData.get("categoryId");
      if (typeof categoryId !== "string")
        return data({ error: "카테고리를 찾을 수 없습니다." }, { status: 400 });
      await deleteGroupCategory(categoryId);
    } else if (
      intent === "approve-join-request" ||
      intent === "reject-join-request"
    ) {
      const requestId = formData.get("requestId");
      if (typeof groupId !== "string" || typeof requestId !== "string")
        return data(
          { error: "가입 요청을 찾을 수 없습니다." },
          { status: 400 },
        );
      if (intent === "approve-join-request")
        await approveGroupJoinRequest(groupId, requestId);
      else await rejectGroupJoinRequest(groupId, requestId);
    } else if (intent === "set-member-role") {
      const memberId = formData.get("memberId");
      const role = formData.get("role");
      if (
        typeof groupId !== "string" ||
        typeof memberId !== "string" ||
        (role !== "admin" && role !== "manager" && role !== "member")
      )
        return data(
          { error: "멤버 역할을 다시 확인해 주세요." },
          { status: 400 },
        );
      await setGroupMemberRole(groupId, memberId, role);
    } else if (intent === "transfer-ownership") {
      const memberId = formData.get("memberId");
      if (typeof groupId !== "string" || typeof memberId !== "string")
        return data({ error: "멤버를 찾을 수 없습니다." }, { status: 400 });
      await transferGroupOwnership(groupId, memberId);
    } else if (intent === "update-settings") {
      const rawName = formData.get("name");
      const description = formData.get("description");
      const joinPolicy = formData.get("joinPolicy");
      const identityPolicy = formData.get("identityPolicy");
      const postingPolicy = formData.get("postingPolicy");
      if (
        typeof groupId !== "string" ||
        typeof rawName !== "string" ||
        typeof description !== "string" ||
        (joinPolicy !== "open" &&
          joinPolicy !== "request" &&
          joinPolicy !== "invite_only") ||
        (identityPolicy !== "identified" &&
          identityPolicy !== "optional_anonymous") ||
        (postingPolicy !== "members" && postingPolicy !== "staff")
      )
        return data(
          { error: "그룹 설정을 다시 확인해 주세요." },
          { status: 400 },
        );
      const name = rawName.trim();
      if (
        !name ||
        Array.from(name).length > 50 ||
        Array.from(description).length > 2000
      ) {
        return data(
          {
            error:
              "그룹 이름은 1자 이상 50자 이하, 설명은 2,000자 이하로 입력해 주세요.",
          },
          { status: 400 },
        );
      }
      await updateGroupSettings(groupId, {
        name,
        description,
        joinPolicy,
        identityPolicy,
        postingPolicy,
      });
    } else if (intent === "pin") {
      if (typeof groupId !== "string")
        return data({ error: "그룹을 찾을 수 없습니다." }, { status: 400 });
      await setGroupPinned(
        groupId,
        profileId,
        formData.get("pinned") === "true",
      );
    } else if (intent === "join") {
      if (typeof groupId !== "string")
        return data({ error: "그룹을 찾을 수 없습니다." }, { status: 400 });
      await joinGroup(groupId, profileId);
    } else if (intent === "request") {
      if (typeof groupId !== "string")
        return data({ error: "그룹을 찾을 수 없습니다." }, { status: 400 });
      await requestGroupJoin(groupId, profileId);
    } else if (intent === "cancel-request") {
      if (typeof groupId !== "string")
        return data({ error: "그룹을 찾을 수 없습니다." }, { status: 400 });
      await cancelGroupJoinRequest(groupId, profileId);
    } else if (intent === "leave") {
      if (typeof groupId !== "string")
        return data({ error: "그룹을 찾을 수 없습니다." }, { status: 400 });
      // 비공개 그룹은 나가는 즉시 상세를 읽을 권한이 사라진다. 이 화면에 머무르면
      // 재검증이 404로 떨어지므로 그룹 목록으로 보낸다.
      if (!(await leaveGroup(groupId, profileId))) {
        return data({ error: "이 그룹은 나갈 수 없습니다." }, { status: 400 });
      }
      removeGroupAccessCache(groupId, params.slug);
      await getQueryClient().invalidateQueries({ queryKey: groupKeys.all });
      return redirect("/groups");
    } else if (intent === "issue-invite") {
      const hours = Number(formData.get("hours"));
      if (
        typeof groupId !== "string" ||
        !Number.isSafeInteger(hours) ||
        hours < 1 ||
        hours > 336
      )
        return data(
          { error: "유효 기간을 다시 확인해 주세요." },
          { status: 400 },
        );
      await issueGroupInvite(groupId, hours);
    } else if (intent === "revoke-invite") {
      if (typeof groupId !== "string")
        return data({ error: "그룹을 찾을 수 없습니다." }, { status: 400 });
      await revokeGroupInvite(groupId);
    } else if (intent === "delete-group") {
      if (typeof groupId !== "string")
        return data({ error: "그룹을 찾을 수 없습니다." }, { status: 400 });
      // 삭제하는 순간 호출자도 멤버가 아니게 되므로 이 화면에 남아 있으면 재검증이 404가 된다.
      await deleteGroup(groupId);
      removeGroupAccessCache(groupId, params.slug);
      await getQueryClient().invalidateQueries({ queryKey: groupKeys.all });
      return redirect("/groups");
    } else {
      return data({ error: "지원하지 않는 요청입니다." }, { status: 400 });
    }
    await invalidateGroupMutation(intent, groupId, params.slug);
    return data({ ok: true });
  } catch (error) {
    return data(
      {
        error: postIntent
          ? getPostErrorMessage(error)
          : getGroupErrorMessage(error),
      },
      { status: 400 },
    );
  }
}

async function invalidateGroupMutation(
  intent: FormDataEntryValue | null,
  groupId: string,
  slug: string,
) {
  const queryClient = getQueryClient();
  const invalidate = (queryKey: readonly unknown[]) =>
    queryClient.invalidateQueries({ queryKey, refetchType: "none" });
  const tasks: Promise<void>[] = [];

  if (
    intent === "pin-post" ||
    intent === "delete-post" ||
    intent === "dismiss-report"
  ) {
    tasks.push(
      invalidate(groupKeys.postPages(groupId)),
      invalidate(groupKeys.detail(slug)),
      invalidate(feedKeys.page(null)),
    );
    if (intent === "dismiss-report" || intent === "delete-post")
      tasks.push(invalidate([...groupKeys.all, "reports", groupId]));
  } else if (
    intent === "create-category" ||
    intent === "rename-category" ||
    intent === "move-category-up" ||
    intent === "move-category-down" ||
    intent === "delete-category"
  ) {
    tasks.push(
      invalidate(groupKeys.categories(groupId)),
      invalidate(groupKeys.postPages(groupId)),
      invalidate(groupKeys.detail(slug)),
      invalidate(feedKeys.page(null)),
    );
  } else if (intent === "pin") {
    tasks.push(
      invalidate(groupKeys.home()),
      invalidate(groupKeys.detail(slug)),
    );
  } else if (
    intent === "join" ||
    intent === "request" ||
    intent === "cancel-request"
  ) {
    tasks.push(
      invalidate(groupKeys.home()),
      invalidate(groupKeys.discoveries()),
      invalidate(groupKeys.detail(slug)),
      invalidate(groupKeys.memberLists(groupId)),
    );
    if (intent === "join") tasks.push(invalidate(feedKeys.all));
  } else if (
    intent === "approve-join-request" ||
    intent === "reject-join-request" ||
    intent === "set-member-role" ||
    intent === "transfer-ownership"
  ) {
    tasks.push(
      invalidate(groupKeys.detail(slug)),
      invalidate(groupKeys.memberLists(groupId)),
      invalidate(groupKeys.joinRequests(groupId)),
      invalidate(groupKeys.home()),
    );
  } else if (intent === "update-settings") {
    tasks.push(
      invalidate(groupKeys.detail(slug)),
      invalidate(groupKeys.home()),
      invalidate(groupKeys.discoveries()),
    );
  } else if (intent === "issue-invite" || intent === "revoke-invite") {
    tasks.push(
      invalidate(groupKeys.invite(groupId)),
      invalidate(groupKeys.detail(slug)),
    );
  }

  await Promise.all(tasks);
}

function removeGroupAccessCache(groupId: string, slug: string) {
  const queryClient = getQueryClient();
  queryClient.removeQueries({
    predicate: (query) => isGroupAccessQuery(query.queryKey, groupId, slug),
  });
  queryClient.removeQueries({ queryKey: feedKeys.all });
}

export default function GroupPage({ loaderData }: Route.ComponentProps) {
  const { profile } = useAppShell();

  return (
    <>
      <GroupDetailMobileHeader
        name={loaderData.group.name}
        iconPath={loaderData.group.icon_path}
        canSearch={loaderData.group.membership_state === "member"}
      />
      <GroupDetailScreen
        group={loaderData.group}
        profileId={profile.id}
        viewerName={profile.name}
        viewerAvatarUrl={profile.avatar_url}
        isTeacher={profile.type === "teacher"}
        canDeleteOfficial={profile.role === "admin"}
        categories={loaderData.categories}
        posts={loaderData.posts}
        memberPage={loaderData.memberPage}
        joinRequests={loaderData.joinRequests}
        invite={loaderData.invite}
        reportPage={loaderData.reportPage}
      />
      <Outlet />
    </>
  );
}

import { data, Outlet, redirect } from "react-router";

import { defineAppChrome, useAppShell } from "~/features/app-shell";
import {
  cancelGroupJoinRequest,
  getGroupErrorMessage,
  GroupDetailMobileHeader,
  GroupDetailScreen,
  joinGroup,
  leaveGroup,
  loadGroupDetail,
  requestGroupJoin,
  setGroupPinned,
} from "~/features/groups";
import {
  createGroupCategory,
  deleteGroupCategory,
  getPostErrorMessage,
  listGroupCategories,
  listGroupPosts,
  moveGroupCategory,
  setGroupPostPinned,
  updateGroupCategory,
} from "~/features/posts";
import type { Route } from "./+types/detail";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "5xl",
});

/**
 * `groups/:slug`. 게시물 상세(`posts/:postId`)를 자식으로 가지므로 `<Outlet />`을 그린다 —
 * 게시물을 열어도 그룹 페이지가 언마운트되지 않아 스크롤 위치와 로더 데이터가 유지된다.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const group = await loadGroupDetail(params.slug);
  if (!group) throw new Response("그룹을 찾을 수 없습니다.", { status: 404 });
  if (group.membership_state !== "member") {
    return { group, categories: [], posts: { posts: [], nextCursor: null } };
  }
  const [categories, posts] = await Promise.all([
    listGroupCategories(group.group_id),
    listGroupPosts(group.group_id),
  ]);
  return { group, categories, posts };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");
  const groupId = formData.get("groupId");
  const profileId = Number(formData.get("profileId"));
  const postIntent =
    intent === "pin-post" ||
    intent === "create-category" ||
    intent === "rename-category" ||
    intent === "move-category-up" ||
    intent === "move-category-down" ||
    intent === "delete-category";
  if (
    !postIntent &&
    (typeof groupId !== "string" || !Number.isSafeInteger(profileId))
  ) {
    return data({ error: "그룹을 찾을 수 없습니다." }, { status: 400 });
  }

  try {
    if (intent === "pin-post") {
      const postId = formData.get("postId");
      if (typeof postId !== "string")
        return data({ error: "게시물을 찾을 수 없습니다." }, { status: 400 });
      await setGroupPostPinned(postId, formData.get("pinned") === "true");
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
      return redirect("/groups");
    } else {
      return data({ error: "지원하지 않는 요청입니다." }, { status: 400 });
    }
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

export default function GroupPage({ loaderData }: Route.ComponentProps) {
  const { profile } = useAppShell();

  return (
    <>
      <GroupDetailMobileHeader
        name={loaderData.group.name}
        iconPath={loaderData.group.icon_path}
      />
      <GroupDetailScreen
        group={loaderData.group}
        profileId={profile.id}
        isTeacher={profile.type === "teacher"}
        categories={loaderData.categories}
        posts={loaderData.posts}
      />
      <Outlet />
    </>
  );
}

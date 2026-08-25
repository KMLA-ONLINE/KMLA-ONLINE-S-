import { data, redirect, useRouteLoaderData } from "react-router";

import { defineAppChrome, useAppShell } from "~/features/app-shell";
import { loadGroupDetail } from "~/features/groups";
import {
  deleteGroupPost,
  getGroupPost,
  getPostErrorMessage,
  GroupPostOverlay,
  listPostComments,
  resolveIdentityOptions,
  setGroupPostPinned,
  shouldRevalidatePostDetail,
} from "~/features/posts";
import type { clientLoader as groupLoader } from "~/routes/app/groups/detail";
import type { Route } from "./+types/post";
import { invalidateSavedGroupPost } from "~/routes/app/groups/post-cache";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "5xl",
});

export const shouldRevalidate = shouldRevalidatePostDetail;

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  // 첨부는 `getGroupPost` 안에서 이어 부르므로, 댓글은 그 전체와 나란히 돈다.
  const [post, comments] = await Promise.all([
    getGroupPost(params.postId),
    listPostComments(params.postId),
  ]);
  if (!post) throw new Response("게시물을 찾을 수 없습니다.", { status: 404 });
  return { post, comments };
}

export async function clientAction({
  request,
  params,
}: Route.ClientActionArgs) {
  const formData = await request.formData();
  try {
    const [group, post] = await Promise.all([
      loadGroupDetail(params.slug),
      getGroupPost(params.postId),
    ]);
    if (!group || post?.group_id !== group.group_id) {
      return data({ error: "게시물을 찾을 수 없습니다." }, { status: 404 });
    }
    if (formData.get("intent") === "delete") {
      await deleteGroupPost(params.postId);
      await invalidateSavedGroupPost(group.group_id);
      throw redirect(`/groups/${params.slug}`);
    }
    if (formData.get("intent") === "pin") {
      await setGroupPostPinned(
        params.postId,
        formData.get("pinned") === "true",
      );
      await invalidateSavedGroupPost(group.group_id);
      return data({ ok: true });
    }
    return data({ error: "지원하지 않는 요청입니다." }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) throw error;
    return data({ error: getPostErrorMessage(error) }, { status: 400 });
  }
}

export default function GroupPostPage({ loaderData }: Route.ComponentProps) {
  const { profile } = useAppShell();
  const parent = useRouteLoaderData<typeof groupLoader>(
    "routes/app/groups/detail",
  );
  if (
    parent?.group.membership_state !== "member" ||
    loaderData.post.group_id !== parent.group.group_id
  ) {
    throw new Response("게시물을 볼 권한이 없습니다.", { status: 403 });
  }
  return (
    <GroupPostOverlay
      mode="detail"
      slug={parent.group.slug}
      groupName={parent.group.name}
      groupId={parent.group.group_id}
      post={loaderData.post}
      identities={resolveIdentityOptions(
        parent.group.identity_policy,
        parent.group.member_role,
      )}
      comments={loaderData.comments}
      viewer={{ name: profile.name, avatarUrl: profile.avatar_url }}
    />
  );
}

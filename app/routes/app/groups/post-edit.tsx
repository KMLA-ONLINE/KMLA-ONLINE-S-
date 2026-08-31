import { useRouteLoaderData } from "react-router";

import { defineAppChrome } from "~/features/app-shell";
import { getGroupPost, GroupPostOverlay } from "~/features/posts";
import type { clientLoader as groupLoader } from "~/routes/app/groups/detail";
import { invalidateSavedGroupPost } from "~/routes/app/groups/post-cache";
import type { Route } from "./+types/post-edit";

export const handle = defineAppChrome({ header: "sticky", bottomNav: "none" });

/**
 * 게시물만 읽는다. 카테고리는 부모 그룹 route가 이미 들고 있으므로 여기서 다시 읽지 않는다 —
 * 게시물을 기다렸다가 그 `group_id`로 카테고리를 부르면 왕복이 줄줄이 붙는다.
 */
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const post = await getGroupPost(params.postId);
  if (!post) throw new Response("게시물을 찾을 수 없습니다.", { status: 404 });
  if (!post.can_edit)
    throw new Response("게시물을 수정할 권한이 없습니다.", { status: 403 });
  return { post };
}

export default function EditGroupPostPage({
  loaderData,
}: Route.ComponentProps) {
  const parent = useRouteLoaderData<typeof groupLoader>(
    "routes/app/groups/detail",
  );
  if (
    parent?.group.membership_state !== "member" ||
    loaderData.post.group_id !== parent.group.group_id
  )
    throw new Response("게시물을 수정할 권한이 없습니다.", { status: 403 });
  return (
    <GroupPostOverlay
      mode="edit"
      slug={parent.group.slug}
      groupName={parent.group.name}
      groupId={parent.group.group_id}
      categories={parent.categories}
      post={loaderData.post}
      anonymousActivityRestriction={parent.anonymousActivityRestriction}
      onSaved={() => invalidateSavedGroupPost(parent.group.group_id)}
    />
  );
}

import { useRouteLoaderData } from "react-router";

import { defineAppChrome } from "~/features/app-shell";
import {
  getGroupPost,
  GroupPostOverlay,
  listGroupCategories,
} from "~/features/posts";
import type { clientLoader as groupLoader } from "~/routes/app/groups/detail";
import type { Route } from "./+types/post-edit";

export const handle = defineAppChrome({ header: "sticky", bottomNav: "none" });

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const post = await getGroupPost(params.postId);
  if (!post) throw new Response("게시물을 찾을 수 없습니다.", { status: 404 });
  if (!post.can_edit)
    throw new Response("게시물을 수정할 권한이 없습니다.", { status: 403 });
  return { post, categories: await listGroupCategories(post.group_id) };
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
      categories={loaderData.categories}
      post={loaderData.post}
    />
  );
}

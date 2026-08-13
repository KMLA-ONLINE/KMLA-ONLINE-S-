import { data, redirect, useRouteLoaderData } from "react-router";

import { defineAppChrome } from "~/features/app-shell";
import {
  deleteGroupPost,
  getGroupPost,
  getPostErrorMessage,
  GroupPostOverlay,
  listGroupCategories,
  setGroupPostPinned,
} from "~/features/posts";
import type { clientLoader as groupLoader } from "~/routes/app/groups/detail";
import type { Route } from "./+types/post";

export const handle = defineAppChrome({ header: "sticky", bottomNav: "none" });

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const post = await getGroupPost(params.postId);
  if (!post) throw new Response("게시물을 찾을 수 없습니다.", { status: 404 });
  const categories = await listGroupCategories(post.group_id);
  return { post, categories };
}

export async function clientAction({
  request,
  params,
}: Route.ClientActionArgs) {
  const formData = await request.formData();
  try {
    if (formData.get("intent") === "delete") {
      await deleteGroupPost(params.postId);
      throw redirect(`/groups/${params.slug}`);
    }
    if (formData.get("intent") === "pin") {
      await setGroupPostPinned(
        params.postId,
        formData.get("pinned") === "true",
      );
      return data({ ok: true });
    }
    return data({ error: "지원하지 않는 요청입니다." }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) throw error;
    return data({ error: getPostErrorMessage(error) }, { status: 400 });
  }
}

export default function GroupPostPage({ loaderData }: Route.ComponentProps) {
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
      categories={loaderData.categories}
      post={loaderData.post}
    />
  );
}

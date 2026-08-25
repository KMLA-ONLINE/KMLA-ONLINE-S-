import { data, redirect } from "react-router";

import { defineAppChrome, useAppShell } from "~/features/app-shell";
import {
  deleteProfilePost,
  getPostErrorMessage,
  getProfilePost,
  listPostComments,
  ProfilePostDetail,
  shouldRevalidatePostDetail,
} from "~/features/posts";
import type { Route } from "./+types/post";
import { invalidateSavedProfilePost } from "~/routes/app/profile/post-cache";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "5xl",
});

export const shouldRevalidate = shouldRevalidatePostDetail;

export async function clientLoader({
  params,
  request,
}: Route.ClientLoaderArgs) {
  // 첨부는 `getProfilePost` 안에서 이어 부르므로, 댓글은 그 전체와 나란히 돈다.
  const [post, comments] = await Promise.all([
    getProfilePost(params.postId),
    listPostComments(params.postId),
  ]);
  if (!post) throw new Response("게시물을 찾을 수 없습니다.", { status: 404 });
  if (post.timeline_pub_id !== params.pubId) {
    const search = new URL(request.url).search;
    throw redirect(
      `/profile/${post.timeline_pub_id}/posts/${post.post_id}${search}`,
    );
  }
  return { post, comments };
}

export async function clientAction({
  request,
  params,
}: Route.ClientActionArgs) {
  const formData = await request.formData();
  if (formData.get("intent") !== "delete") {
    return data({ error: "지원하지 않는 요청입니다." }, { status: 400 });
  }
  try {
    await deleteProfilePost(params.postId);
    await invalidateSavedProfilePost();
    throw redirect(`/profile/${params.pubId}`);
  } catch (error) {
    if (error instanceof Response) throw error;
    return data({ error: getPostErrorMessage(error) }, { status: 400 });
  }
}

export default function ProfilePostPage({ loaderData }: Route.ComponentProps) {
  const { profile } = useAppShell();

  return (
    <ProfilePostDetail
      post={loaderData.post}
      comments={loaderData.comments}
      viewer={{ name: profile.name, avatarUrl: profile.avatar_url }}
    />
  );
}

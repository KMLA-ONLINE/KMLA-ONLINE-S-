import { defineAppChrome } from "~/features/app-shell";
import { getProfilePost, ProfilePostEditor } from "~/features/posts";
import type { Route } from "./+types/post-edit";

export const handle = defineAppChrome({ header: "sticky", bottomNav: "none" });

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const post = await getProfilePost(params.postId);
  if (!post) throw new Response("게시물을 찾을 수 없습니다.", { status: 404 });
  if (!post.can_edit) {
    throw new Response("게시물을 수정할 권한이 없습니다.", { status: 403 });
  }
  return { post };
}

export default function EditProfilePostPage({
  loaderData,
}: Route.ComponentProps) {
  const { post } = loaderData;

  return (
    <ProfilePostEditor
      mode="edit"
      timelinePubId={post.timeline_pub_id}
      timelineName={post.timeline_name}
      // 공개 범위는 자기 타임라인 글에서만 고를 수 있다(기능 명세 §8.4).
      canChooseVisibility={post.author_pub_id === post.timeline_pub_id}
      post={post}
    />
  );
}

import { loadGroupDetail } from "~/features/groups";
import type { FeedPostDetailResult } from "~/features/feed";
import {
  getGroupPost,
  getProfilePost,
  listPostComments,
  resolveIdentityOptions,
} from "~/features/posts";
import type { Route } from "./+types/post-data";

export async function clientLoader({
  params,
  request,
}: Route.ClientLoaderArgs): Promise<FeedPostDetailResult> {
  const searchParams = new URL(request.url).searchParams;
  const kind = searchParams.get("kind");
  const source = searchParams.get("source");

  try {
    if (kind === "group" && source) {
      const [post, comments, group] = await Promise.all([
        getGroupPost(params.postId),
        listPostComments(params.postId),
        loadGroupDetail(source),
      ]);
      if (
        !post ||
        group?.membership_state !== "member" ||
        post.group_id !== group.group_id
      ) {
        throw new Error("게시물을 볼 수 없습니다.");
      }

      return {
        requestedPostId: params.postId,
        detail: {
          kind: "group",
          post,
          comments,
          slug: group.slug,
          groupName: group.name,
          groupId: group.group_id,
          identities: resolveIdentityOptions(
            group.identity_policy,
            group.member_role,
          ),
        },
        error: null,
      };
    }

    if (kind === "profile") {
      const [post, comments] = await Promise.all([
        getProfilePost(params.postId),
        listPostComments(params.postId),
      ]);
      if (!post || (source && post.timeline_pub_id !== source)) {
        throw new Error("게시물을 볼 수 없습니다.");
      }

      return {
        requestedPostId: params.postId,
        detail: { kind: "profile", post, comments },
        error: null,
      };
    }

    throw new Error("게시물 경로가 올바르지 않습니다.");
  } catch (error) {
    return {
      requestedPostId: params.postId,
      detail: null,
      error:
        error instanceof Error
          ? error.message
          : "게시물을 불러오지 못했습니다.",
    };
  }
}

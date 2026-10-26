import { groupKeys, loadGroupDetail } from "~/features/groups";
import type { FeedPostDetailResult } from "~/features/feed";
import {
  getGroupPost,
  getProfilePost,
  listPostComments,
} from "~/features/posts";
import { getCurrentLocale, translate } from "~/shared/i18n";
import { getQueryClient } from "~/shared/lib/query-client";
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
        // 멤버십·작성 신원 정책·역할은 댓글 신원 선택지를 정하므로 캐시가 아니라 지금 값을 읽는다. 2분 묵은
        // 값이면 그 사이 바뀐 정책이나 강등이 반영되지 않아 고를 수 없는 신원이 보이고 등록이 실패한다.
        // 게시물·댓글과 나란히 나가므로 왕복은 늘지 않는다. 받은 값은 그룹 화면의 캐시도 갱신한다.
        getQueryClient().fetchQuery({
          queryKey: groupKeys.detail(source),
          queryFn: () => loadGroupDetail(source),
          staleTime: 0,
        }),
      ]);
      if (
        !post ||
        group?.membership_state !== "member" ||
        post.group_id !== group.group_id
      ) {
        throw new Error(
          translate(getCurrentLocale(), "게시물을 볼 수 없습니다."),
        );
      }

      return {
        requestedPostId: params.postId,
        detail: {
          kind: "group",
          post,
          comments,
          slug: group.slug,
          groupName: group.name,
          group: {
            groupId: group.group_id,
            identityPolicy: group.identity_policy,
            memberRole: group.member_role,
          },
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
        throw new Error(
          translate(getCurrentLocale(), "게시물을 볼 수 없습니다."),
        );
      }

      return {
        requestedPostId: params.postId,
        detail: { kind: "profile", post, comments },
        error: null,
      };
    }

    throw new Error(
      translate(getCurrentLocale(), "게시물 경로가 올바르지 않습니다."),
    );
  } catch (error) {
    return {
      requestedPostId: params.postId,
      detail: null,
      error:
        error instanceof Error
          ? error.message
          : translate(getCurrentLocale(), "게시물을 불러오지 못했습니다."),
    };
  }
}

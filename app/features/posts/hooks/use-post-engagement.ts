import { useQuery } from "@tanstack/react-query";

import { postKeys } from "~/features/posts/data/cache";
import type { PostEngagement } from "~/features/posts/model/types";

/**
 * 서버가 준 게시물 snapshot에 뮤테이션 뒤의 engagement만 덮는다.
 *
 * 비활성 Query observer가 cache write와 QueryClient clear 경계만 구독하고 네트워크 요청을 만들지 않는다.
 */
export function usePostEngagement(
  postId: string,
  server: PostEngagement,
): PostEngagement {
  const { data } = useQuery<Partial<PostEngagement>>({
    queryKey: postKeys.engagement(postId),
    queryFn: () => Promise.resolve({}),
    enabled: false,
  });

  return { ...server, ...data };
}

import { useQuery } from "@tanstack/react-query";

import { postKeys } from "~/features/posts/data/cache";
import type { PostEngagement } from "~/features/posts/model/types";

/** 서버 snapshot에 뮤테이션 뒤의 engagement만 덮는다. 비활성 observer라 네트워크 요청은 만들지 않는다. */
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

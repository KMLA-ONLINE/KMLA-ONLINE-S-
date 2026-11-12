import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { recordPostOpened } from "~/features/notifications/data/cache";

/**
 * 게시물 상세가 화면에 뜰 때 한 번 열람을 기록한다. loader에서 보내지 않는 이유는 댓글·반응 제출이나
 * 다른 화면의 동작으로도 loader가 다시 돌기 때문이다. 그러면 보는 도중 온 알림이나, 피드에서 닫아 둔 글의
 * 알림까지 읽음이 된다. 같은 글이 새 데이터로 다시 그려지는 것은 새로 연 것이 아니다.
 * 볼 수 있다고 확인되기 전에는 `null`을 넘긴다.
 */
export function useRecordPostOpened(postId: string | null) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (postId) recordPostOpened(queryClient, postId);
  }, [queryClient, postId]);
}

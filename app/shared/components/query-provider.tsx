import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigation } from "react-router";

import { getQueryClient } from "~/shared/lib/query-client";
import { syncUserScopedStorage } from "~/shared/lib/user-scoped-storage";
import { getSupabase } from "~/shared/supabase/client";

export function QueryProvider({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  const [storageReady, setStorageReady] = useState(false);
  const navigating = useNavigation().state !== "idle";
  // router 상태는 `startTransition`으로 반영되므로 auth 콜백에서는 마지막으로 그려진 값을 읽는다.
  const navigatingRef = useRef(navigating);
  // 계정이 바뀐 navigation(로그아웃 action → `/login` redirect)이 끝날 때까지 화면을 다시 열지 않는다.
  // 저장소 정리는 금방 끝나서, 그대로 열면 떠나는 중인 이전 화면이 빈 캐시로 다시 마운트되고
  // 세션 없이 쿼리를 보내 401을 쏟는다.
  const [heldForNavigation, setHeldForNavigation] = useState(false);
  if (heldForNavigation && !navigating) setHeldForNavigation(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    navigatingRef.current = navigating;
  }, [navigating]);

  useEffect(() => {
    let activeUserId: string | null | undefined;
    let sequence = 0;
    let syncChain = Promise.resolve();
    let disposed = false;

    const synchronizeStorage = (nextUserId: string | null, retry = false) => {
      // TOKEN_REFRESHED 같은 같은 사용자 이벤트는 이미 안전한 저장소를 다시 막지 않는다.
      if (!retry && activeUserId === nextUserId && sequence > 0) return;

      const currentSequence = ++sequence;
      clearTimeout(retryTimer.current);

      if (activeUserId !== undefined && activeUserId !== nextUserId) {
        queryClient.clear();
        setHeldForNavigation(navigatingRef.current);
      }
      // `localStorage`는 새로고침을 넘어 남는다. 탭이 기억하는 이전 사용자만 보면 "탭만 닫고 다른 사람이 로그인"을 놓치므로 저장소의 주인 기준으로 매번 맞춘다.
      activeUserId = nextUserId;
      setStorageReady(false);

      // auth 이벤트가 연달아 와도 Cache Storage 삭제와 OWNER_KEY 갱신은 순서를 지킨다.
      // 이전 삭제가 늦게 끝나 새 사용자를 다시 owner로 적는 역전 경합을 막는다.
      syncChain = syncChain
        .catch(() => undefined)
        .then(() => syncUserScopedStorage(nextUserId));

      void syncChain.then(
        () => {
          if (!disposed && currentSequence === sequence) {
            setStorageReady(true);
          }
        },
        () => {
          if (!disposed && currentSequence === sequence) {
            // Cache Storage 삭제 실패는 무시하면 안 된다. owner를 아직 바꾸지 않았으므로
            // 같은 사용자로 다시 동기화해도 실제 삭제를 재시도한다.
            retryTimer.current = setTimeout(
              () => synchronizeStorage(nextUserId, true),
              1_000,
            );
          }
        },
      );
    };

    const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
      synchronizeStorage(session?.user.id ?? null);
    });

    return () => {
      disposed = true;
      clearTimeout(retryTimer.current);
      data.subscription.unsubscribe();
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {storageReady && !heldForNavigation ? children : null}
    </QueryClientProvider>
  );
}

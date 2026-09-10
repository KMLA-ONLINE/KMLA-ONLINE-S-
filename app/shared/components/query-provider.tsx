import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { getQueryClient } from "~/shared/lib/query-client";
import { syncUserScopedStorage } from "~/shared/lib/user-scoped-storage";
import { getSupabase } from "~/shared/supabase/client";

export function QueryProvider({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  const [storageReady, setStorageReady] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

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
      }
      // 메모리 캐시와 달리 `localStorage`는 새로고침을 넘어 살아남는다. 이 탭이 기억하는
      // 이전 사용자만 보면 "로그아웃하지 않고 탭만 닫은 뒤 다른 사람이 로그인"을 놓치므로,
      // 판단은 저장소에 적힌 주인에게 맡기고 여기서는 매번 맞춰 달라고만 한다.
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
      {storageReady ? children : null}
    </QueryClientProvider>
  );
}

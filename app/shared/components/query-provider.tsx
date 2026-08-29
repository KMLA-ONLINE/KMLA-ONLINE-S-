import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";

import { getQueryClient } from "~/shared/lib/query-client";
import { syncUserScopedStorage } from "~/shared/lib/user-scoped-storage";
import { getSupabase } from "~/shared/supabase/client";

export function QueryProvider({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();

  useEffect(() => {
    let activeUserId: string | null | undefined;
    const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user.id ?? null;

      if (activeUserId !== undefined && activeUserId !== nextUserId) {
        queryClient.clear();
      }
      // 메모리 캐시와 달리 `localStorage`는 새로고침을 넘어 살아남는다. 이 탭이 기억하는
      // 이전 사용자만 보면 "로그아웃하지 않고 탭만 닫은 뒤 다른 사람이 로그인"을 놓치므로,
      // 판단은 저장소에 적힌 주인에게 맡기고 여기서는 매번 맞춰 달라고만 한다.
      syncUserScopedStorage(nextUserId);
      activeUserId = nextUserId;
    });

    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

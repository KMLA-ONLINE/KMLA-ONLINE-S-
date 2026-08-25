import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";

import { getQueryClient } from "~/shared/lib/query-client";
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
      activeUserId = nextUserId;
    });

    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

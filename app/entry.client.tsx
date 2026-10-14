import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

import { seedColdStartBackStack } from "~/shared/lib/back-stack";
import { getQueryClient } from "~/shared/lib/query-client";
import { hasStoredSession } from "~/shared/supabase/client";

// 라우터가 history를 읽기 전에 깔아야 첫 화면의 location state에 표시가 실린다. 로그인하지 않았으면
// 게이트가 목적지와 깔아 둔 화면을 모두 로그인으로 돌려보내므로 깔지 않는다.
if (hasStoredSession()) seedColdStartBackStack();

startTransition(() => {
  // 초기 loader도 focus/online 복귀로 재시도를 재개해야 한다. Provider는
  // loader 완료 후에 마운트되므로, 브라우저 진입점에서 먼저 구독한다.
  const queryClient = getQueryClient();
  queryClient.mount();

  const root = hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );

  import.meta.hot?.dispose(() => {
    root.unmount();
    queryClient.unmount();
  });
});

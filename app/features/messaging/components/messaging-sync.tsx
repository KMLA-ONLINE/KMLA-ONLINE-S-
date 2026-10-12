import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  invalidateConversationList,
  openConversationIds,
} from "~/features/messaging/data/cache";
import { subscribeToMessagingSignals } from "~/features/messaging/data/subscriptions";
import {
  catchUpConversation,
  refreshReadState,
} from "~/features/messaging/data/sync";

/** 한 번의 변경이 신호 여러 개(행 갱신마다 하나)로 오므로 짧게 모아 한 번만 따라잡는다. */
const SIGNAL_COALESCE_MS = 150;

/** 따라잡기가 실패하면 이 간격으로 다시 시도한다. 다 실패하면 다음 신호나 복귀에 맡긴다. */
const RETRY_DELAYS_MS = [1_000, 3_000, 10_000];

type SyncKind = "changes" | "reads";

/**
 * 메시지 Realtime 신호와 창 복귀를 받아 대화 목록과 열린 대화방을 서버와 맞춘다(기술 설계 §5). 신호는
 * 지연을 줄이는 수단일 뿐이다. 놓쳐도 다음 신호나 복귀가 따라잡기로 빈 구간을 메운다.
 */
export function MessagingSync({ profileId }: { profileId: number }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const scheduler = createSyncScheduler(queryClient, String(profileId));
    const isOpen = (conversationId: string) =>
      openConversationIds(queryClient).includes(conversationId);
    const resync = () => {
      void invalidateConversationList(queryClient);
      for (const id of openConversationIds(queryClient)) {
        scheduler.schedule(id, "changes");
      }
    };
    const onResume = () => {
      if (document.visibilityState === "visible") resync();
    };

    const unsubscribe = subscribeToMessagingSignals(profileId, {
      onMessageChanged: (conversationId, kind) => {
        // 반응·고정은 목록의 미리보기와 읽지 않은 수를 바꾸지 않는다.
        if (kind === "content") scheduler.scheduleList();
        if (isOpen(conversationId))
          scheduler.schedule(conversationId, "changes");
      },
      onReadChanged: (conversationId) => {
        if (isOpen(conversationId)) scheduler.schedule(conversationId, "reads");
      },
      // 처음 붙을 때도 맞춘다. loader가 읽은 뒤 채널이 붙기 전의 신호는 받을 수 없었다.
      onSubscribed: resync,
    });
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("online", resync);

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("online", resync);
      scheduler.dispose();
    };
  }, [profileId, queryClient]);

  return null;
}

/**
 * 대화마다 따라잡기를 하나씩만 돌린다. 도는 중에 신호가 오면 끝난 뒤 한 번 더 돈다. 실패하면 간격을
 * 늘리며 몇 번 다시 시도한다.
 */
function createSyncScheduler(queryClient: QueryClient, viewerId: string) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, Set<SyncKind>>();
  const running = new Set<string>();
  const failures = new Map<string, number>();
  let listTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function queue(conversationId: string, kinds: Iterable<SyncKind>) {
    const queued = pending.get(conversationId) ?? new Set<SyncKind>();
    for (const kind of kinds) queued.add(kind);
    pending.set(conversationId, queued);
  }

  function arm(conversationId: string, delay: number) {
    if (disposed || running.has(conversationId) || timers.has(conversationId))
      return;
    timers.set(
      conversationId,
      setTimeout(() => {
        timers.delete(conversationId);
        void run(conversationId);
      }, delay),
    );
  }

  async function run(conversationId: string) {
    const kinds = pending.get(conversationId);
    pending.delete(conversationId);
    if (!kinds || disposed) return;
    running.add(conversationId);
    try {
      if (kinds.has("changes")) {
        await catchUpConversation(queryClient, conversationId);
      }
      if (kinds.has("reads")) {
        await refreshReadState(queryClient, conversationId, viewerId);
      }
      failures.delete(conversationId);
    } catch {
      const attempt = failures.get(conversationId) ?? 0;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) {
        failures.set(conversationId, attempt + 1);
        queue(conversationId, kinds);
        running.delete(conversationId);
        arm(conversationId, delay);
        return;
      }
      // 다 실패했다. 다음 신호나 복귀가 처음부터 다시 시도한다.
      failures.delete(conversationId);
    } finally {
      running.delete(conversationId);
    }
    if (pending.has(conversationId)) void run(conversationId);
  }

  return {
    schedule(conversationId: string, kind: SyncKind) {
      queue(conversationId, [kind]);
      arm(conversationId, SIGNAL_COALESCE_MS);
    },
    scheduleList() {
      if (listTimer) return;
      listTimer = setTimeout(() => {
        listTimer = null;
        void invalidateConversationList(queryClient);
      }, SIGNAL_COALESCE_MS);
    },
    dispose() {
      disposed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      if (listTimer) clearTimeout(listTimer);
    },
  };
}

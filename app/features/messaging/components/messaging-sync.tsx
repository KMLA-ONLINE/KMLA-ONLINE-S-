import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import {
  invalidateConversationList,
  invalidateUnreadMessageCount,
  messagingKeys,
  openConversationIds,
  removeConversationFromList,
} from "~/features/messaging/data/cache";
import {
  subscribeToMessagingSignals,
  subscribeToRoomSignals,
} from "~/features/messaging/data/subscriptions";
import {
  catchUpConversation,
  refreshConversationInList,
  refreshReadState,
} from "~/features/messaging/data/sync";

/** 한 번의 변경이 신호 여러 개(행 갱신마다 하나)로 오므로 짧게 모아 한 번만 따라잡는다. */
const SIGNAL_COALESCE_MS = 150;
/**
 * 읽음 신호는 더 길게 모은다. 그룹에서는 멤버마다 읽을 때 신호가 오고, 방을 연 사람마다 최근 메시지의
 * 읽음 수를 다시 받으므로 요청이 멤버 수의 제곱으로 는다. 숫자가 1초 늦게 바뀌는 건 티가 나지 않는다.
 */
const READ_COALESCE_MS = 1_000;
/**
 * 화면으로 돌아올 때 이 시간 안에 이미 맞췄으면 다시 읽지 않는다. 모바일은 앱을 자주 오가고, 목록을
 * 다시 읽으면 서버가 모든 대화의 마지막 메시지를 복호화한다. 연결이 끊겼다 붙으면 `onSubscribed`가
 * 따로 맞춘다.
 */
const RESUME_RESYNC_MIN_INTERVAL_MS = 30_000;

/** 따라잡기가 실패하면 이 간격으로 다시 시도한다. 다 실패하면 다음 신호나 복귀에 맡긴다. */
const RETRY_DELAYS_MS = [1_000, 3_000, 10_000];

type SyncKind = "changes" | "reads";

/**
 * 메시지 Realtime 신호와 창 복귀를 받아 대화 목록과 열린 대화방을 서버와 맞춘다(기술 설계 §5). 신호는
 * 지연을 줄이는 수단일 뿐이다. 놓쳐도 다음 신호나 복귀가 따라잡기로 빈 구간을 메운다. 메시지 신호는 내
 * topic 하나로 받고, 읽음 신호는 열린 대화방마다 그 방의 topic을 구독해 받는다.
 */
export function MessagingSync({ profileId }: { profileId: number }) {
  const queryClient = useQueryClient();
  // 신호 구독을 다시 맺지 않도록 이동 함수는 ref로 들고 있는다.
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    const scheduler = createSyncScheduler(queryClient);
    const isOpen = (conversationId: string) =>
      openConversationIds(queryClient).includes(conversationId);
    // 끊긴 동안 잃은 신호에는 다른 멤버의 읽음도 있다. 바뀐 시각에 잡히지 않으므로 함께 다시 받는다.
    let lastResyncAt = 0;
    const resync = () => {
      lastResyncAt = Date.now();
      void invalidateConversationList(queryClient);
      for (const id of openConversationIds(queryClient)) {
        scheduler.schedule(id, "changes");
        scheduler.schedule(id, "reads");
      }
    };
    const onResume = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastResyncAt >= RESUME_RESYNC_MIN_INTERVAL_MS
      ) {
        resync();
      }
    };

    const unsubscribe = subscribeToMessagingSignals(profileId, {
      onMessageChanged: (conversationId, kind) => {
        // 반응·고정은 목록의 미리보기와 읽지 않은 수를 바꾸지 않는다.
        if (kind === "content") scheduler.scheduleList(conversationId);
        if (isOpen(conversationId))
          scheduler.schedule(conversationId, "changes");
      },
      // 지운 그룹은 목록에서 바로 뺀다. 그 방을 보고 있었으면 알리고 대화 목록으로 돌아간다.
      onConversationDeleted: (conversationId) => {
        removeConversationFromList(queryClient, conversationId);
        void invalidateUnreadMessageCount(queryClient);
        if (window.location.pathname === `/messenger/${conversationId}`) {
          toast("채팅방이 삭제되었습니다.");
          void navigateRef.current("/messenger", { replace: true });
        }
      },
      // 처음 붙을 때도 맞춘다. loader가 읽은 뒤 채널이 붙기 전의 신호는 받을 수 없었다.
      onSubscribed: resync,
    });
    const rooms = createRoomSubscriptions(queryClient, profileId, {
      // 닫혀 있던 동안, 또는 loader가 읽은 뒤 화면이 붙기 전의 메시지 신호는 열린 방이 아니라 버렸다.
      onOpened: (id) => scheduler.schedule(id, "changes"),
      onReadChanged: (id) => scheduler.schedule(id, "reads"),
    });
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("online", resync);

    return () => {
      unsubscribe();
      rooms.dispose();
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("online", resync);
      scheduler.dispose();
    };
  }, [profileId, queryClient]);

  return null;
}

/**
 * 열린 대화방(메시지 cache를 구독하는 화면이 있는 방)마다 그 방의 읽음 topic을 구독한다. 방이 열리고
 * 닫히는 것은 cache의 observer 변화로 안다. 같은 tick에 떨어졌다 다시 붙는 observer(다시 마운트)에
 * 채널을 끊었다 맺지 않도록 다음 tick에 맞춘다. 방이 열리면 `onOpened`를 부르고, 채널이 붙을 때도
 * 읽음을 다시 받는다. loader가 읽은 뒤 채널이 붙기 전의 신호는 받을 수 없었다.
 */
function createRoomSubscriptions(
  queryClient: QueryClient,
  profileId: number,
  handlers: {
    onOpened: (conversationId: string) => void;
    onReadChanged: (conversationId: string) => void;
  },
) {
  const rooms = new Map<string, () => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function reconcile() {
    timer = null;
    const open = new Set(openConversationIds(queryClient));
    for (const [id, unsubscribe] of rooms) {
      if (open.has(id)) continue;
      unsubscribe();
      rooms.delete(id);
    }
    for (const id of open) {
      if (rooms.has(id)) continue;
      const refresh = () => handlers.onReadChanged(id);
      handlers.onOpened(id);
      rooms.set(
        id,
        subscribeToRoomSignals(id, profileId, {
          onReadChanged: refresh,
          onSubscribed: refresh,
        }),
      );
    }
  }

  reconcile();
  const cache = queryClient.getQueryCache();
  const unsubscribeCache = cache.subscribe((event) => {
    if (timer) return;
    if (event.type !== "observerAdded" && event.type !== "observerRemoved") {
      return;
    }
    // cache 이벤트의 query는 `any`로 타입이 잡혀 있어 hash로 다시 찾아 키를 좁힌다.
    const key = cache.get(event.query.queryHash)?.queryKey ?? [];
    if (key[0] === messagingKeys.all[0] && key[1] === "messages") {
      timer = setTimeout(reconcile, 0);
    }
  });

  return {
    dispose() {
      unsubscribeCache();
      if (timer) clearTimeout(timer);
      for (const unsubscribe of rooms.values()) unsubscribe();
      rooms.clear();
    },
  };
}

/**
 * 대화마다 따라잡기를 하나씩만 돌린다. 도는 중에 신호가 오면 끝난 뒤 한 번 더 돈다. 실패하면 간격을
 * 늘리며 몇 번 다시 시도한다.
 */
function createSyncScheduler(queryClient: QueryClient) {
  const timers = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; at: number }
  >();
  const pending = new Map<string, Set<SyncKind>>();
  const running = new Set<string>();
  const failures = new Map<string, number>();
  let listTimer: ReturnType<typeof setTimeout> | null = null;
  const listConversations = new Set<string>();
  let disposed = false;

  function queue(conversationId: string, kinds: Iterable<SyncKind>) {
    const queued = pending.get(conversationId) ?? new Set<SyncKind>();
    for (const kind of kinds) queued.add(kind);
    pending.set(conversationId, queued);
  }

  /** 더 이른 시각으로만 당긴다. 읽음을 기다리는 중에 온 새 메시지는 읽음 간격만큼 늦추지 않는다. */
  function arm(conversationId: string, delay: number) {
    if (disposed || running.has(conversationId)) return;
    const at = Date.now() + delay;
    const armed = timers.get(conversationId);
    if (armed) {
      if (armed.at <= at) return;
      clearTimeout(armed.timer);
    }
    timers.set(conversationId, {
      at,
      timer: setTimeout(() => {
        timers.delete(conversationId);
        void run(conversationId);
      }, delay),
    });
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
        await refreshReadState(queryClient, conversationId);
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
      arm(
        conversationId,
        kind === "reads" ? READ_COALESCE_MS : SIGNAL_COALESCE_MS,
      );
    },
    scheduleList(conversationId: string) {
      listConversations.add(conversationId);
      if (listTimer) return;
      listTimer = setTimeout(() => {
        listTimer = null;
        const ids = [...listConversations];
        listConversations.clear();
        for (const id of ids) {
          // 실패하면 목록 전체를 다시 읽는다. 다음 신호를 기다리면 미리보기가 낡은 채 남는다.
          refreshConversationInList(queryClient, id).catch(
            () => void invalidateConversationList(queryClient),
          );
        }
      }, SIGNAL_COALESCE_MS);
    },
    dispose() {
      disposed = true;
      for (const { timer } of timers.values()) clearTimeout(timer);
      if (listTimer) clearTimeout(listTimer);
    },
  };
}

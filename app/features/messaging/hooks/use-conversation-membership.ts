import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import {
  conversationListQuery,
  invalidateConversationList,
  removeConversationFromList,
} from "~/features/messaging/data/cache";
import {
  addConversationMembers,
  createGroupConversation,
  deleteGroupConversation,
  leaveConversation,
  openDirectConversation,
  renameConversation,
  setConversationNickname,
} from "~/features/messaging/data/mutations";
import { refreshConversationInList } from "~/features/messaging/data/sync";
import type { RecipientSelection } from "~/features/messaging/components/recipient-picker-dialog";
import type { Conversation } from "~/features/messaging/model/types";
import type { RoomEntryState } from "~/features/messaging/hooks/use-room-entry";

/**
 * 대화방이 loader로 받은 대화 정보에 대화 목록의 최신 값을 덮는다. 이름, 멤버, 알림 상태는 다른
 * 멤버가 바꿀 수 있고, 그 변경은 Realtime 신호가 목록의 그 대화 한 줄을 다시 읽어 들어온다.
 */
export function useListedConversation(
  conversation: Conversation,
): Conversation {
  const { data } = useQuery(conversationListQuery());
  const listed = data?.find(({ id }) => id === conversation.id);
  return useMemo(
    () =>
      listed
        ? {
            ...conversation,
            name: listed.name,
            participants: listed.participants,
            notificationLevel: listed.notificationLevel,
            canDelete: listed.canDelete,
          }
        : conversation,
    [conversation, listed],
  );
}

/**
 * 그룹 멤버 관리(기능 명세 §13.15, §13.16, §13.25). 바꾼 뒤 대화 목록의 그 대화를 다시 읽어 멤버와 이름,
 * 별명을 맞춘다. 실패하면 알리고 false로 끝난다.
 */
export function useConversationMembership(conversationId: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function run(action: () => Promise<void>, failure: string) {
    try {
      await action();
    } catch {
      toast.error(failure);
      return false;
    }
    await refreshConversationInList(queryClient, conversationId, {
      attachmentsChanged: false,
    }).catch(() => invalidateConversationList(queryClient));
    return true;
  }

  return {
    invite: (profileIds: string[]) =>
      run(
        () => addConversationMembers(conversationId, profileIds),
        "멤버를 초대하지 못했습니다.",
      ),
    // 스스로 나간 그룹은 목록에서 사라지므로 대화 목록으로 돌아간다. 뒤로가기가 나간 대화방으로
    // 돌아오지 않게 지금 entry를 바꾼다.
    leave: async () => {
      try {
        await leaveConversation(conversationId);
      } catch {
        toast.error("채팅에서 나가지 못했습니다.");
        return false;
      }
      removeConversationFromList(queryClient, conversationId);
      void invalidateConversationList(queryClient);
      await navigate("/messenger", { replace: true });
      return true;
    },
    // 지운 그룹은 모두의 목록에서 사라진다. 나가기와 같이 대화 목록으로 돌아간다.
    deleteGroup: async () => {
      try {
        await deleteGroupConversation(conversationId);
      } catch {
        toast.error("채팅방을 삭제하지 못했습니다.");
        return false;
      }
      removeConversationFromList(queryClient, conversationId);
      void invalidateConversationList(queryClient);
      await navigate("/messenger", { replace: true });
      toast.success("채팅방을 삭제했습니다.");
      return true;
    },
    rename: (name: string) =>
      run(
        () => renameConversation(conversationId, name),
        "그룹 이름을 바꾸지 못했습니다.",
      ),
    setNickname: (profileId: string, nickname: string) =>
      run(
        () => setConversationNickname(conversationId, profileId, nickname),
        "별명을 바꾸지 못했습니다.",
      ),
  };
}

/**
 * 새 대화를 열고 그 대화방으로 간다. 한 명이면 1:1 대화, 여러 명이면 그룹이다. `entry`는 대화방
 * entry를 쌓을지 바꿀지다(`useRoomEntry`).
 */
export function useStartConversation(entry: {
  replace: boolean;
  state: RoomEntryState;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return async ({ recipients, groupName }: RecipientSelection) => {
    try {
      const [only] = recipients;
      const conversationId =
        recipients.length === 1 && only
          ? await openDirectConversation(only.id)
          : await createGroupConversation(
              groupName,
              recipients.map(({ id }) => id),
            );
      await invalidateConversationList(queryClient);
      await navigate(`/messenger/${conversationId}`, entry);
    } catch (error) {
      toast.error("채팅을 시작하지 못했습니다.");
      throw error;
    }
  };
}

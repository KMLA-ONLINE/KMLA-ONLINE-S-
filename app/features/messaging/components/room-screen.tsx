import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  EllipsisIcon,
  FileIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageIcon,
  InfoIcon,
  PaperclipIcon,
  PencilIcon,
  PinIcon,
  ReplyIcon,
  SearchIcon,
  SendIcon,
  SmileIcon,
  ThumbsUpIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  type CSSProperties,
  type Dispatch,
  memo,
  type RefObject,
  type SetStateAction,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { randomUUID } from "~/shared/lib/random-uuid";
import { useLocation, useNavigate } from "react-router";

import { ConversationAvatar } from "~/features/messaging/components/conversation-avatar";
import { ConversationDetails } from "~/features/messaging/components/conversation-details";
import { copyMessageText } from "~/features/messaging/components/copy-message";
import {
  MessageActionRail,
  MessageRow,
} from "~/features/messaging/components/message-row";
import { PinnedMessagesDialog } from "~/features/messaging/components/pinned-messages-dialog";
import {
  useConversationMessages,
  type OlderMessagesResult,
} from "~/features/messaging/hooks/use-conversation-messages";
import {
  useConversationMembership,
  useListedConversation,
} from "~/features/messaging/hooks/use-conversation-membership";
import {
  MessageParticipantsProvider,
  useMessageParticipants,
} from "~/features/messaging/components/message-mention";
import {
  MentionSuggestionList,
  mentionOptionId,
} from "~/features/messaging/components/mention-suggestion-list";
import { useMentionSuggestions } from "~/features/messaging/hooks/use-mention-suggestions";
import { useConversationNotificationLevel } from "~/features/messaging/hooks/use-conversation-notification-level";
import { useRoomOverlayParam } from "~/features/messaging/hooks/use-room-overlay-param";
import type { RoomEntryState } from "~/features/messaging/hooks/use-room-entry";
import {
  readRoomDraft,
  roomDraftKey,
  updateRoomDraft,
} from "~/features/messaging/hooks/room-drafts";
import {
  EMPTY_MESSAGE_SEARCH,
  MessageSearchPanel,
} from "~/features/messaging/components/message-search-panel";
import { ReactionMembersDialog } from "~/features/messaging/components/reaction-members-dialog";
import { SharedMediaDialog } from "~/features/messaging/components/shared-media-dialog";
import { getSharedAttachmentCounts } from "~/features/messaging/data/queries";
import { messagingKeys } from "~/features/messaging/data/cache";
import { useQuery } from "@tanstack/react-query";
import { IMAGE_INPUT_ACCEPT } from "~/shared/lib/image/compress";
import { clipboardImageFiles } from "~/shared/lib/clipboard";
import {
  classifyAttachment,
  formatFileSize,
  screenAttachments,
} from "~/features/messaging/model/attachments";
import { useIsSendEnter } from "~/shared/hooks/use-enter-to-send";
import { useKeyboardViewport } from "~/shared/hooks/use-keyboard-viewport";
import { RecipientPickerDialog } from "~/features/messaging/components/recipient-picker-dialog";
import { RenameConversationDialog } from "~/features/messaging/components/rename-conversation-dialog";
import { ConversationNicknamesDialog } from "~/features/messaging/components/conversation-nicknames-dialog";
import {
  activeParticipants,
  formatSystemMessage,
  isViewerActive,
} from "~/features/messaging/model/system-message";
import {
  canEditMessage,
  EDIT_EXPIRED_MESSAGE,
} from "~/features/messaging/model/message-edit";
import { formatReplyPreview } from "~/features/messaging/model/conversation-preview";
import { layoutMessageThread } from "~/features/messaging/model/message-grouping";
import { formatMessageDay } from "~/features/messaging/model/message-time";
import type {
  Conversation,
  ConversationMessage,
  MessageParticipant,
} from "~/features/messaging/model/types";
import {
  countMessageGraphemes,
  MESSAGE_MAX_LENGTH,
  normalizeMessageBody,
} from "~/features/messaging/model/message-text";
import {
  addMessageMention,
  isUnchangedEdit,
  messageMentionEntries,
  messagePlainText,
  prepareMessageMentions,
  type MessageMentionSuggestion,
  type PreparedMessageMentions,
} from "~/features/messaging/model/message-mentions";
import {
  QuickReactionBar,
  ReactionPickerSurface,
} from "~/features/posts/components/reaction/quick-reaction-bar";
import {
  MENTION_HIGHLIGHT_INPUT_CLASS,
  MentionHighlight,
} from "~/features/posts/components/mention-highlight";
import { useMentionTextarea } from "~/features/posts/hooks/use-mention-textarea";
import {
  fromMentionDisplay,
  mentionDisplayText,
  mentionCountReason,
  toMentionDisplay,
  type MentionDraftEntry,
} from "~/features/posts/model/mentions";
import type { PostReaction } from "~/features/posts/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { UserAvatar } from "~/shared/components/user-avatar";
import { toast } from "sonner";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { isAboveSeededParent } from "~/shared/lib/back-stack";
import { isHandheld, isIOS } from "~/shared/lib/install-platform";
import { cn } from "~/shared/lib/utils";

export interface DesktopDetailsContext {
  desktopDetailsOpen: boolean;
  setDesktopDetailsOpen: Dispatch<SetStateAction<boolean>>;
}

const BOTTOM_SCROLL_BUTTON_THRESHOLD = 200;
/** 맨 아래에서 이만큼 안이면 맨 아래를 보고 있는 것으로 보고, 새 메시지가 오면 따라 내려간다. */
const FOLLOW_NEW_MESSAGES_THRESHOLD = 80;
/**
 * 맨 위까지 대화 영역 높이의 이 배수만큼 남으면 앞선 메시지를 미리 읽는다. 한 화면보다 짧으면 빠르게
 * 넘길 때 다 읽기 전에 맨 위에 닿아 스크롤이 멈춘다.
 */
const OLDER_MESSAGES_THRESHOLD_SCREENS = 2;
/** 대화 영역이 아주 낮아도(키보드가 떠 있을 때 등) 이만큼은 미리 읽는다. */
const OLDER_MESSAGES_MIN_THRESHOLD = 400;
/** 메시지·좋아요를 보내거나 반응을 바꾼 뒤 다음 전송까지 쉬는 시간. 도배를 막는 UI 제한이다. */
const SEND_COOLDOWN_MS = 500;
/**
 * 글이나 첨부를 보낸 뒤 이만큼은 빈 입력의 버튼을 눌러도 좋아요를 보내지 않는다. 버튼 모양은 바로 바뀌므로,
 * 전송 버튼을 한 번 더 누른 손가락이 의도하지 않은 좋아요를 보내지 않게 막는다.
 */
const LIKE_AFTER_SEND_MS = 1_000;
/** 메시지 입력창과 멘션 뒤판이 함께 쓰는 글자 크기와 높이. 어긋나면 뒤판의 글자가 캐럿과 떨어진다. */
const MESSAGE_INPUT_TEXT_CLASS = "max-h-32 text-base leading-6 md:text-[15px]";
/** 대화 정보가 대화 옆에 붙는 폭. 이보다 좁으면 대화 정보는 열 때만 대화를 덮는다. */
const WIDE_ROOM_QUERY = "(min-width: 80rem)";

function subscribeToWideRoomQuery(onChange: () => void) {
  const query = window.matchMedia(WIDE_ROOM_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isWideRoomViewport() {
  return window.matchMedia(WIDE_ROOM_QUERY).matches;
}

function subscribeToPlatform() {
  return () => undefined;
}

export function RoomScreen({
  conversation: loadedConversation,
  desktopDetailsOpen = true,
  onDesktopDetailsOpenChange,
}: {
  conversation: Conversation;
  desktopDetailsOpen?: boolean;
  onDesktopDetailsOpenChange?: (open: boolean) => void;
}) {
  // 이름과 멤버는 다른 멤버가 바꿀 수 있어 대화 목록의 최신 값을 쓴다.
  const conversation = useListedConversation(loadedConversation);
  const viewerActive = isViewerActive(conversation);
  const participantById = new Map(
    conversation.participants.map((participant) => [
      participant.id,
      participant,
    ]),
  );
  const membership = useConversationMembership(conversation.id);
  const [memberDialog, setMemberDialog] = useState<
    | { kind: "invite" }
    | { kind: "rename" }
    | { kind: "leave" }
    | { kind: "delete" }
    | null
  >(null);
  // 대화 정보, 검색, 고정 메시지, 반응한 사람, 공유된 미디어는 뒤로가기로 닫히도록 URL에 둔다.
  const roomOverlay = useRoomOverlayParam();
  const ios = useSyncExternalStore(subscribeToPlatform, isIOS, () => false);
  const keyboardViewport = useKeyboardViewport(ios, ios);
  const location = useLocation();
  const navigate = useNavigate();
  const overlay = roomOverlay.overlay;
  const compactDetailsOpen = overlay?.kind === "details";
  const searchOpen = overlay?.kind === "search";
  const pinnedDialogOpen = overlay?.kind === "pinned";
  const [findingMessage, setFindingMessage] = useState(false);
  // 검색 입력과 결과. 결과로 이동해 검색이 닫혀도 남겨 두어, 다시 열면 다음 결과를 이어 고른다.
  const [searchSession, setSearchSession] = useState(EMPTY_MESSAGE_SEARCH);
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);
  const {
    messages,
    pinnedMessages,
    hasOlderMessages,
    loadingOlderMessages,
    loadOlderMessages,
    send,
    sendFiles,
    retry,
    discard,
    loadUntil,
    react,
    togglePinned,
    edit,
    removeMany,
  } = useConversationMessages(conversation);
  // 삭제 모드에서 고른 내 메시지. `null`이면 삭제 모드가 아니다(기능 명세 §13.11).
  const [selection, setSelection] = useState<ReadonlySet<string> | null>(null);
  // 삭제 모드는 Esc로도 끝낸다. 열린 대화상자가 있으면 그쪽이 Esc를 먼저 쓴다.
  const selecting = selection !== null;
  useEffect(() => {
    if (!selecting) return;
    function cancelOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        setSelection(null);
      }
    }
    document.addEventListener("keydown", cancelOnEscape);
    return () => document.removeEventListener("keydown", cancelOnEscape);
  }, [selecting]);
  // 대화 정보가 보일 때 공유된 첨부 수를 센다. 첨부가 바뀌면 메시지 신호가 다시 읽게 한다. 대화
  // 정보가 닫힌 동안에는 읽지 않는다. 그동안의 신호는 낡았다고만 표시해 두고 열 때 한 번 읽는다.
  const wideRoom = useSyncExternalStore(
    subscribeToWideRoomQuery,
    isWideRoomViewport,
    () => false,
  );
  const { data: sharedCounts } = useQuery({
    queryKey: messagingKeys.sharedAttachmentCounts(conversation.id),
    queryFn: () => getSharedAttachmentCounts(conversation.id),
    staleTime: 60_000,
    enabled:
      overlay?.kind === "shared" ||
      // 넓은 화면은 옆 패널, 좁은 화면은 덮는 패널이 보인다. 다른 쪽 상태는 CSS로 숨겨져 있다.
      (wideRoom ? desktopDetailsOpen : compactDetailsOpen),
  });
  const reactionsTarget =
    overlay?.kind === "reactions"
      ? messages.find(({ id }) => id === overlay.messageId)
      : undefined;
  const { notificationLevel, setNotificationLevel } =
    useConversationNotificationLevel(conversation);
  const draftKey = roomDraftKey(conversation.viewerId, conversation.id);
  // 끌어 놓거나 붙여 넣은 첨부. 바로 보내지 않고 작성창 위에 두었다가 전송할 때 함께 보낸다.
  // 다른 방에 다녀와도 남도록 파일은 초안에 맡기고, 미리보기는 돌아올 때 다시 만든다.
  const [staged, setStaged] = useState<StagedAttachment[]>(() =>
    (readRoomDraft(draftKey)?.files ?? []).map(toStagedAttachment),
  );
  const stagedRef = useRef(staged);
  useEffect(() => {
    stagedRef.current = staged;
    updateRoomDraft(draftKey, { files: staged.map(({ file }) => file) });
  }, [draftKey, staged]);
  // 대화방을 떠나면(방마다 다시 마운트된다) 쌓아 둔 미리보기를 해제한다.
  useEffect(
    () => () => {
      for (const item of stagedRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    },
    [],
  );
  const [replyTarget, setReplyTarget] = useState<ConversationMessage | null>(
    null,
  );
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const messageThreadRef = useRef<HTMLDivElement>(null);
  /** 메시지마다 마지막으로 반응을 바꾼 시각. 짧은 간격의 연타는 버린다. */
  const reactedAt = useRef(new Map<string, number>());
  /** 방금 보낸 메시지. 그 메시지가 화면에 나타날 때 맨 아래로 내린다. */
  const sentMessageId = useRef<string | null>(null);
  // 맨 아래를 보고 있었는지. 새 메시지가 붙기 직전의 스크롤 위치로 판단해야 하므로 스크롤할 때 적어
  // 둔다. 붙은 뒤에 재면 새 메시지 높이만큼 이미 맨 아래에서 멀어져 있다. 내가 보내면 어디를 보던
  // 맨 아래를 따라간다. 긴 메시지는 그린 뒤에도 줄바꿈과 작성창이 줄며 높이가 다시 바뀐다.
  const followingNewMessagesRef = useRef(true);
  const composingAtBottomRef = useRef(false);
  const compositionFrame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (compositionFrame.current !== null)
        cancelAnimationFrame(compositionFrame.current);
    },
    [],
  );
  function restoreComposerBottom() {
    const thread = messageThreadRef.current;
    if (!thread || !composingAtBottomRef.current) return;
    const bottom = Math.max(0, thread.scrollHeight - thread.clientHeight);
    if (bottom - thread.scrollTop > 1) thread.scrollTop = bottom;
  }
  function preserveCompositionPosition() {
    if (!ios || !followingNewMessagesRef.current) return;
    composingAtBottomRef.current = true;
    if (compositionFrame.current !== null)
      cancelAnimationFrame(compositionFrame.current);
    // Safari reveals the caret after input/layout, including changes with no resize.
    // Keep following through that native adjustment, without scrolling the document.
    compositionFrame.current = requestAnimationFrame(() => {
      restoreComposerBottom();
      compositionFrame.current = requestAnimationFrame(() => {
        restoreComposerBottom();
        composingAtBottomRef.current = false;
        compositionFrame.current = null;
      });
    });
  }
  const pinnedMessage = pinnedMessages.at(-1);
  const pinnedMessageAuthor = pinnedMessage?.senderId
    ? (conversation.participants.find(({ id }) => id === pinnedMessage.senderId)
        ?.name ?? "알 수 없는 사용자")
    : null;
  const replyAuthor = replyTarget?.senderId
    ? (conversation.participants.find(({ id }) => id === replyTarget.senderId)
        ?.name ?? "알 수 없는 사용자")
    : null;

  useEffect(() => {
    if (!highlightedMessageId) return;
    const timeout = window.setTimeout(
      () => setHighlightedMessageId(null),
      1600,
    );
    return () => window.clearTimeout(timeout);
  }, [highlightedMessageId]);

  useEffect(() => {
    const messageThread = messageThreadRef.current;
    if (messageThread) messageThread.scrollTop = messageThread.scrollHeight;
  }, [conversation.id]);

  // 다음 변경이 아니라 보낸 메시지 자체를 기다린다. 앞선 페이지가 먼저 붙으면 그 변경에
  // 반응해 내려가고 정작 보낸 메시지가 나타날 때는 아무것도 하지 않게 된다.
  useEffect(() => {
    const id = sentMessageId.current;
    if (!id || !messages.some((message) => message.id === id)) return;
    const messageThread = messageThreadRef.current;
    if (messageThread) messageThread.scrollTop = messageThread.scrollHeight;
    sentMessageId.current = null;
  }, [messages]);

  /**
   * 대화 목록으로 돌아간다. 목록에서 들어왔으면 대화방과 그 위의 오버레이 entry를 함께 되돌려
   * 뒤로가기가 대화방으로 다시 들어오지 않게 한다. 프로필처럼 다른 곳에서 들어왔으면 오버레이를
   * 닫고 대화방 entry를 목록으로 바꾼다. 그 아래는 들어오기 전 화면이다. 앱이 대화방으로 처음 열려
   * 밑에 목록을 깔아 두었으면 목록에서 들어온 것과 같다.
   */
  async function backToList() {
    const entry = location.state as RoomEntryState | null;
    if (entry?.roomAboveList || isAboveSeededParent(entry)) {
      await navigate(-(roomOverlay.depth + 1));
      return;
    }
    await roomOverlay.closeAll();
    await navigate("/messenger", { replace: true });
  }

  function openDetails() {
    if (isWideRoomViewport()) {
      onDesktopDetailsOpenChange?.(true);
      return;
    }
    if (!compactDetailsOpen) roomOverlay.open({ kind: "details" });
  }

  // 원래 메시지로 이동해 강조한다. 아직 불러오지 않은 구간이면 그 메시지까지 앞선 페이지를 이어 읽는다.
  async function viewMessage(messageId: string) {
    await roomOverlay.closeAll();
    // 아직 불러오지 않은 구간이면 앞선 페이지를 여러 번 이어 읽는다. 그동안 멈춘 것처럼 보이지 않게
    // 대화 위쪽에 찾는 중임을 보인다.
    setFindingMessage(true);
    const found = await loadUntil(messageId).finally(() =>
      setFindingMessage(false),
    );
    if (!found) {
      toast.error("메시지를 찾을 수 없습니다.");
      return;
    }
    setHighlightedMessageId(messageId);
    // 지난 메시지로 가는 중이다. 맨 아래를 따라가면 붙은 페이지나 그림이 자리를 바꿀 때 다시 끌려 내려간다.
    followingNewMessagesRef.current = false;
    requestAnimationFrame(() => {
      const messageThread = messageThreadRef.current;
      const target = document.getElementById(`message-${messageId}`);
      if (messageThread && target) centerInThread(messageThread, target);
    });
  }

  /** 보낼 수 없는 파일은 빼고, 이미 쌓아 둔 것까지 합쳐 사진 30장·파일 10개까지만 쌓는다. */
  function stageFiles(selected: File[]) {
    const { files, notices } = screenAttachments(
      selected,
      staged.map(({ file }) => file),
    );
    for (const notice of notices) toast.error(notice);
    if (files.length === 0) return;
    setStaged((current) => [...current, ...files.map(toStagedAttachment)]);
  }

  function unstage(id: string) {
    const item = staged.find((entry) => entry.id === id);
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setStaged((current) => current.filter((entry) => entry.id !== id));
  }

  /** 쌓아 둔 첨부를 보낸다. 보내는 메시지는 각자 미리보기를 새로 만들므로 여기의 것은 바로 해제한다. */
  function sendStaged() {
    for (const item of staged) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    }
    const files = staged.map(({ file }) => file);
    setStaged([]);
    setReplyTarget(null);
    followingNewMessagesRef.current = true;
    void sendFiles(files);
  }

  // 보내지 못하면 메시지가 목록에 "보내지 못함"으로 남아 다시 보낼 수 있으므로 입력과 답장 대상은
  // 되살리지 않는다.
  async function sendMessage({
    body,
    mentionPubIds,
    mentionsEveryone,
  }: PreparedMessageMentions) {
    const target = replyTarget;
    const id = randomUUID();
    sentMessageId.current = id;
    followingNewMessagesRef.current = true;
    setReplyTarget(null);
    const sent = await send({
      id,
      body,
      mentionPubIds,
      mentionsEveryone,
      replyTo: target
        ? {
            id: target.id,
            senderId: target.senderId,
            body: messagePlainText(target, participantById),
            deleted: target.deleted,
            attachmentKind: target.attachments?.[0]?.kind ?? null,
          }
        : undefined,
    });
    return sent;
  }

  // 고친 내용은 먼저 그린다. 실패하면 hook이 메시지를 되돌리고, 여기서는 고치던 입력과 함께
  // 수정 모드를 되살린다. 그새 다른 수정을 시작했으면 두지 않는다.
  // 고치는 사이 15분이 지났으면 보내지 않고 이유를 알린다. 되살려도 계속 실패하므로 수정 모드를 끝낸다.
  async function submitEdit(edited: PreparedMessageMentions) {
    const { body, mentionPubIds, mentionsEveryone, entries } = edited;
    const target = editTarget?.message;
    if (!target) return;
    setEditTarget(null);
    if (isUnchangedEdit(target, edited, conversation.participants)) return;
    if (!canEditMessage(target, conversation.viewerId)) {
      toast.error(EDIT_EXPIRED_MESSAGE);
      return;
    }
    const saved = await edit(target, body, mentionPubIds, mentionsEveryone);
    if (!saved && canEditMessage(target, conversation.viewerId)) {
      setEditTarget(
        (current) =>
          current ?? { message: target, draft: body, mentions: entries },
      );
    }
  }

  return (
    <MessageParticipantsProvider participants={conversation.participants}>
      <div
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 overflow-hidden",
          // iOS에서 아래 여백으로 보정하면 Safari의 화면 이동과 겹쳐 이름이 밀리고
          // 입력창 아래에 빈 공간이 생긴다. 보이는 영역의 위쪽·높이로 대화방 전체를 잡는다.
          keyboardViewport.keyboardOpen &&
            "max-md:fixed max-md:inset-x-0 max-md:z-40 max-md:h-(--room-keyboard-height)",
          keyboardViewport.keyboardOpen && "max-md:top-(--room-keyboard-top)",
        )}
        style={
          keyboardViewport.keyboardOpen
            ? ({
                "--room-keyboard-height": `${keyboardViewport.height}px`,
                "--room-keyboard-top": `${keyboardViewport.offsetTop}px`,
              } as CSSProperties & Record<`--room-keyboard-${string}`, string>)
            : undefined
        }
      >
        <section
          aria-label={`${conversation.name} 채팅`}
          className={cn(
            "min-h-0 min-w-0 flex-1 flex-col bg-background",
            compactDetailsOpen ? "hidden xl:flex" : "flex",
          )}
        >
          <header className="z-10 flex h-[calc(var(--app-page-header-h)+var(--app-safe-t))] shrink-0 items-center gap-2 border-b bg-background px-2 pt-[var(--app-safe-t)] md:h-16 md:px-4 md:pt-0">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full md:hidden"
              aria-label="채팅 목록으로 돌아가기"
              onClick={() => void backToList()}
            >
              <ChevronLeftIcon aria-hidden />
            </Button>
            {/* 이름을 누르면 대화 정보를 연다. 넓은 화면에서 접어 둔 정보 패널도 다시 편다. */}
            <button
              type="button"
              aria-label={`${conversation.name} 채팅 정보 보기`}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={openDetails}
            >
              <ConversationAvatar
                conversation={conversation}
                className="size-10"
              />
              <h1 className="min-w-0 flex-1 truncate text-sm font-semibold md:text-base">
                {conversation.name}
              </h1>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label="채팅 검색"
              onClick={() => roomOverlay.open({ kind: "search" })}
            >
              <SearchIcon aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full xl:hidden"
              aria-label="채팅 정보 열기"
              onClick={() => roomOverlay.open({ kind: "details" })}
            >
              <InfoIcon aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hidden rounded-full xl:inline-flex"
              aria-label={
                desktopDetailsOpen ? "채팅 정보 닫기" : "채팅 정보 열기"
              }
              aria-pressed={desktopDetailsOpen}
              onClick={() => onDesktopDetailsOpenChange?.(!desktopDetailsOpen)}
            >
              <InfoIcon aria-hidden />
            </Button>
          </header>

          {searchOpen ? (
            <MessageSearchPanel
              conversationId={conversation.id}
              participants={participantById}
              session={searchSession}
              onSessionChange={setSearchSession}
              onClose={roomOverlay.close}
              onSelect={(result) => void viewMessage(result.id)}
            />
          ) : null}

          {pinnedMessage ? (
            <button
              type="button"
              aria-label="고정 메시지"
              className="flex min-h-14 shrink-0 items-center gap-3 border-b bg-muted/40 px-4 py-2.5 text-left hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => roomOverlay.open({ kind: "pinned" })}
            >
              <PinIcon aria-hidden className="size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">
                  {pinnedMessageAuthor ?? "알 수 없는 사용자"}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {formatReplyPreview(
                    toReplyPreview(pinnedMessage, participantById),
                    window.location.origin,
                  )}
                </p>
              </div>
              {/* 가장 최근 것만 보이므로 여럿이면 몇 개인지 알린다. 누르면 목록이 열린다. */}
              {pinnedMessages.length > 1 ? (
                <span
                  aria-hidden
                  className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                >
                  {pinnedMessages.length}
                </span>
              ) : null}
            </button>
          ) : null}

          <MessageThread
            ios={ios}
            composingAtBottomRef={composingAtBottomRef}
            conversation={conversation}
            messages={messages}
            highlightedMessageId={highlightedMessageId}
            messageThreadRef={messageThreadRef}
            followingNewMessagesRef={followingNewMessagesRef}
            desktopDetailsOpen={desktopDetailsOpen}
            hasOlderMessages={hasOlderMessages}
            findingMessage={findingMessage}
            loadingOlderMessages={loadingOlderMessages}
            onLoadOlderMessages={loadOlderMessages}
            onSelectReaction={(message, reaction) => {
              const now = Date.now();
              const last = reactedAt.current.get(message.id) ?? 0;
              if (now - last < SEND_COOLDOWN_MS) return;
              reactedAt.current.set(message.id, now);
              void react(message, reaction);
            }}
            onReply={(message) => {
              if (message.deleted) return;
              setEditTarget(null);
              setReplyTarget(message);
            }}
            onTogglePinned={togglePinned}
            onEdit={(message) => {
              setReplyTarget(null);
              setEditTarget({
                message,
                draft: message.body,
                mentions: messageMentionEntries(
                  message,
                  conversation.participants,
                ),
              });
            }}
            // 삭제는 삭제 모드로 들어가 그 메시지를 고른 채로 시작한다. 더 고른 뒤 아래 삭제 버튼으로
            // 한 번에 지운다(기능 명세 §13.11).
            onDelete={(message) => {
              setReplyTarget(null);
              setEditTarget(null);
              setSelection(new Set([message.id]));
            }}
            onViewMessage={(messageId) => void viewMessage(messageId)}
            selection={selection}
            onToggleSelection={(message) =>
              setSelection((current) => {
                if (!current) return current;
                const next = new Set(current);
                if (next.has(message.id)) next.delete(message.id);
                else next.add(message.id);
                return next;
              })
            }
            onRetry={retry}
            onDiscard={discard}
            onShowReactions={(message) =>
              roomOverlay.open({ kind: "reactions", messageId: message.id })
            }
            onDropFiles={
              viewerActive && !selection && !editTarget && !replyTarget
                ? stageFiles
                : undefined
            }
          />
          {selection ? (
            <div className="flex shrink-0 items-center gap-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+var(--app-safe-b))]">
              <p
                className="min-w-0 flex-1 text-sm font-medium"
                aria-live="polite"
              >
                {selection.size}개 선택됨
              </p>
              <Button variant="outline" onClick={() => setSelection(null)}>
                취소
              </Button>
              <Button
                variant="destructive"
                disabled={selection.size === 0}
                onClick={() => {
                  removeMany(messages.filter(({ id }) => selection.has(id)));
                  setSelection(null);
                }}
              >
                삭제
              </Button>
            </div>
          ) : viewerActive ? (
            <ComposerShell
              onDraftInput={preserveCompositionPosition}
              keyboardOpenOnIOS={ios && keyboardViewport.keyboardOpen}
              replyTarget={replyTarget ?? undefined}
              replyAuthor={replyAuthor}
              onCancelReply={() => setReplyTarget(null)}
              editTarget={editTarget ?? undefined}
              onCancelEdit={() => setEditTarget(null)}
              onEdit={submitEdit}
              onSend={sendMessage}
              staged={staged}
              onStageFiles={stageFiles}
              onUnstage={unstage}
              onSendStaged={sendStaged}
              onSendFiles={(files) => {
                setReplyTarget(null);
                followingNewMessagesRef.current = true;
                void sendFiles(files);
              }}
              desktopDetailsOpen={desktopDetailsOpen}
              draftKey={draftKey}
              mentionParticipants={
                conversation.type === "group" ? conversation.participants : null
              }
              viewerId={conversation.viewerId}
            />
          ) : (
            <p className="shrink-0 px-4 pt-3 pb-[calc(0.75rem+var(--app-safe-b))] text-center text-sm text-muted-foreground">
              이 채팅에서 나왔습니다. 참여한 동안의 메시지만 볼 수 있습니다.
            </p>
          )}
        </section>

        <ConversationDetails
          conversation={conversation}
          onMobileBack={roomOverlay.close}
          pinnedCount={pinnedMessages.length}
          onOpenPinnedMessages={() => roomOverlay.open({ kind: "pinned" })}
          notificationLevel={notificationLevel}
          onNotificationLevelChange={setNotificationLevel}
          onSearch={() => {
            roomOverlay.open({ kind: "search" }, { replace: true });
          }}
          onInvite={() => setMemberDialog({ kind: "invite" })}
          onRename={() => setMemberDialog({ kind: "rename" })}
          onNicknames={() => roomOverlay.open({ kind: "nicknames" })}
          onLeave={() => setMemberDialog({ kind: "leave" })}
          onDeleteGroup={() => setMemberDialog({ kind: "delete" })}
          sharedCounts={sharedCounts}
          onOpenSharedMedia={(tab) => roomOverlay.open({ kind: "shared", tab })}
          className={cn(
            compactDetailsOpen ? "flex xl:hidden" : "hidden",
            compactDetailsOpen &&
              "md:absolute md:inset-y-0 md:right-0 md:shadow-xl xl:static xl:shadow-none",
            desktopDetailsOpen ? "xl:flex" : "xl:hidden",
          )}
        />
        <PinnedMessagesDialog
          open={pinnedDialogOpen}
          messages={pinnedMessages}
          participants={conversation.participants}
          viewerId={conversation.viewerId}
          isGroup={conversation.type === "group"}
          onOpenChange={(open) => {
            if (!open) roomOverlay.close();
          }}
          onViewMessage={(messageId) => void viewMessage(messageId)}
          onUnpin={togglePinned}
        />
        <RecipientPickerDialog
          open={memberDialog?.kind === "invite"}
          mode="invite"
          excludeIds={activeParticipants(conversation).map(({ id }) => id)}
          onOpenChange={(open) => {
            if (!open) setMemberDialog(null);
          }}
          onSubmit={async ({ recipients }) => {
            const invited = await membership.invite(
              recipients.map(({ id }) => id),
            );
            if (!invited) throw new Error("invite failed");
            setMemberDialog(null);
          }}
        />
        {overlay?.kind === "nicknames" ? (
          <ConversationNicknamesDialog
            participants={conversation.participants}
            viewerId={conversation.viewerId}
            keyboardViewport={ios ? keyboardViewport : undefined}
            onCancel={roomOverlay.close}
            onSubmit={membership.setNickname}
          />
        ) : null}
        {memberDialog?.kind === "rename" ? (
          <RenameConversationDialog
            currentName={conversation.name}
            onCancel={() => setMemberDialog(null)}
            onSubmit={membership.rename}
          />
        ) : null}
        {memberDialog?.kind === "leave" ? (
          <ConfirmDialog
            title="그룹에서 나갈까요?"
            description="나가면 채팅 목록에서 사라지고, 이후 메시지는 볼 수 없습니다."
            confirmLabel="나가기"
            destructive
            onCancel={() => setMemberDialog(null)}
            onConfirm={() => {
              setMemberDialog(null);
              void membership.leave();
            }}
          />
        ) : null}
        {memberDialog?.kind === "delete" ? (
          <ConfirmDialog
            title="채팅방을 삭제할까요?"
            description="모든 멤버의 목록에서 채팅방이 사라지고, 메시지와 사진·파일도 함께 지워집니다. 되돌릴 수 없습니다."
            confirmLabel="삭제"
            destructive
            onCancel={() => setMemberDialog(null)}
            onConfirm={() => {
              setMemberDialog(null);
              void membership.deleteGroup();
            }}
          />
        ) : null}
        {overlay?.kind === "shared" ? (
          <SharedMediaDialog
            conversationId={conversation.id}
            initialTab={overlay.tab}
            counts={sharedCounts}
            onClose={roomOverlay.close}
          />
        ) : null}
        {reactionsTarget ? (
          <ReactionMembersDialog
            message={reactionsTarget}
            onClose={roomOverlay.close}
          />
        ) : null}
      </div>
    </MessageParticipantsProvider>
  );
}

function MessageThread({
  composingAtBottomRef,
  ios,
  conversation,
  messages,
  highlightedMessageId,
  messageThreadRef,
  followingNewMessagesRef,
  desktopDetailsOpen,
  hasOlderMessages,
  loadingOlderMessages,
  findingMessage,
  onLoadOlderMessages,
  onSelectReaction,
  onReply,
  onTogglePinned,
  onEdit,
  onDelete,
  onViewMessage,
  selection,
  onToggleSelection,
  onRetry,
  onDiscard,
  onShowReactions,
  onDropFiles,
}: {
  composingAtBottomRef: RefObject<boolean>;
  ios: boolean;
  conversation: Conversation;
  messages: ConversationMessage[];
  highlightedMessageId: string | null;
  messageThreadRef: RefObject<HTMLDivElement | null>;
  /** 맨 아래를 따라가는 중인지. 보내는 쪽(`RoomScreen`)도 켠다. */
  followingNewMessagesRef: RefObject<boolean>;
  desktopDetailsOpen: boolean;
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  /** 답장 인용, 고정 메시지, 검색 결과의 원래 메시지를 찾아 앞선 페이지를 읽는 중인지. */
  findingMessage: boolean;
  onLoadOlderMessages: () => Promise<OlderMessagesResult>;
  onSelectReaction: (
    message: ConversationMessage,
    reaction: PostReaction,
  ) => void;
  onReply: (message: ConversationMessage) => void;
  onTogglePinned: (message: ConversationMessage) => void;
  onEdit: (message: ConversationMessage) => void;
  onDelete: (message: ConversationMessage) => void;
  onViewMessage: (messageId: string) => void;
  selection: ReadonlySet<string> | null;
  onToggleSelection: (message: ConversationMessage) => void;
  onRetry: (message: ConversationMessage) => void;
  onDiscard: (message: ConversationMessage) => void;
  onShowReactions: (message: ConversationMessage) => void;
  /** 데스크톱에서 대화 영역에 끌어 놓은 파일을 보낸다. 보낼 수 없는 상태면 없다. */
  onDropFiles?: (files: File[]) => void;
}) {
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const threadContentRef = useRef<HTMLDivElement>(null);
  const observedThreadHeight = useRef<number | null>(null);
  const scrollingToBottom = useRef(false);
  const previousScrollTop = useRef(0);
  const contextPortalRef = useRef<HTMLDivElement>(null);
  const participantById = new Map(
    conversation.participants.map((participant) => [
      participant.id,
      participant,
    ]),
  );
  // 앞선 페이지를 위에 붙이면 scrollHeight만 늘고 scrollTop은 그대로라 보던 메시지가 아래로
  // 밀린다. 붙이기 전 바닥에서의 거리와 그때의 맨 위 메시지를 기억했다가, 맨 위가 실제로 바뀐
  // 렌더에서만 같은 거리로 되돌린다. 읽기가 실패하거나 빈 페이지가 오면 버린다.
  const olderAnchor = useRef<{
    distanceFromBottom: number;
    oldestMessageId: string | undefined;
  } | null>(null);
  // 읽기가 실패한 뒤에는 맨 위 근처에서 스크롤할 때마다 다시 부르지 않는다. 사용자가 그 구간을
  // 벗어났다가 다시 올라오면 한 번 더 시도한다.
  const olderLoadFailed = useRef(false);
  // 날짜 구분선과 묶음 경계는 메시지가 바뀔 때만 다시 센다. 키보드가 오르내리거나 오버레이가 열려
  // 이 영역이 다시 그려질 때마다 메시지 전체의 시각을 포매팅하지 않는다.
  const layout = useMemo(() => layoutMessageThread(messages), [messages]);
  const oldestMessageId = messages[0]?.id;
  const newestMessage = messages.at(-1);
  const newestMessageId = newestMessage?.id;
  // 맨 아래에서 마지막으로 본 가장 최근 메시지. 지난 대화를 보던 중에 상대 메시지가 새로 오면 이와
  // 달라지고, 맨 아래 이동 버튼 자리에 그 메시지를 미리 보여 준다.
  // 다른 대화방으로 바뀌면 그 방의 최근 메시지를 본 것으로 다시 시작한다.
  const [seen, setSeen] = useState({
    conversationId: conversation.id,
    messageId: newestMessageId,
  });
  if (seen.conversationId !== conversation.id) {
    setSeen({ conversationId: conversation.id, messageId: newestMessageId });
  }
  const seenNewestId = seen.messageId;
  const incomingMessage =
    showScrollToBottom &&
    newestMessage &&
    newestMessage.id !== seenNewestId &&
    !newestMessage.system &&
    newestMessage.senderId !== conversation.viewerId
      ? newestMessage
      : undefined;
  const incomingSender = incomingMessage?.senderId
    ? participantById.get(incomingMessage.senderId)
    : undefined;
  // 부모가 렌더마다 새로 만드는 콜백을 그대로 넘기면 `ThreadMessage`의 memo가 매번 깨진다.
  // 행에는 한 번 만든 객체를 넘기고, 호출 시점에 최신 콜백을 읽는다.
  const latestHandlers = useRef({
    onSelectReaction,
    onReply,
    onTogglePinned,
    onEdit,
    onDelete,
    onViewMessage,
    onToggleSelection,
    onRetry,
    onDiscard,
    onShowReactions,
  });
  useLayoutEffect(() => {
    latestHandlers.current = {
      onSelectReaction,
      onReply,
      onTogglePinned,
      onEdit,
      onDelete,
      onViewMessage,
      onToggleSelection,
      onRetry,
      onDiscard,
      onShowReactions,
    };
  });
  const actions = useMemo<ThreadMessageActions>(
    () => ({
      selectReaction: (message, reaction) =>
        latestHandlers.current.onSelectReaction(message, reaction),
      reply: (message) => latestHandlers.current.onReply(message),
      togglePinned: (message) => latestHandlers.current.onTogglePinned(message),
      edit: (message) => latestHandlers.current.onEdit(message),
      delete: (message) => latestHandlers.current.onDelete(message),
      viewMessage: (messageId) =>
        latestHandlers.current.onViewMessage(messageId),
      toggleSelection: (message) =>
        latestHandlers.current.onToggleSelection(message),
      retry: (message) => latestHandlers.current.onRetry(message),
      discard: (message) => latestHandlers.current.onDiscard(message),
      showReactions: (message) =>
        latestHandlers.current.onShowReactions(message),
    }),
    [],
  );

  useLayoutEffect(() => {
    const messageThread = messageThreadRef.current;
    const anchor = olderAnchor.current;
    if (!messageThread || !anchor) return;
    if (anchor.oldestMessageId === oldestMessageId) return;
    messageThread.scrollTop =
      messageThread.scrollHeight - anchor.distanceFromBottom;
    olderAnchor.current = null;
  }, [oldestMessageId, messageThreadRef]);

  // 맨 아래를 보고 있을 때 새 메시지가 붙으면 따라 내려간다. 위로 올려 지난 대화를 보던 중이면
  // 그대로 두고 맨 아래 이동 버튼으로 알린다. 앞선 페이지가 위에 붙을 때는 가장 최근 메시지가
  // 바뀌지 않으므로 여기에 걸리지 않는다.
  useLayoutEffect(() => {
    const messageThread = messageThreadRef.current;
    if (!messageThread || !followingNewMessagesRef.current) return;
    messageThread.scrollTop = messageThread.scrollHeight;
  }, [newestMessageId, messageThreadRef, followingNewMessagesRef]);

  function markNewestMessageSeen() {
    setSeen((previous) =>
      previous.conversationId === conversation.id &&
      previous.messageId === newestMessageId
        ? previous
        : { conversationId: conversation.id, messageId: newestMessageId },
    );
  }

  // 맨 아래를 보고 있는 동안에는 메시지가 늘지 않아도 맨 아래에 붙어 있는다. 반응이 붙거나 사진이
  // 늦게 그려지거나 키보드·답장 표시로 대화 영역이 줄면 높이만 바뀌어 아래가 가려진다.
  // observer는 대화 영역이 그대로인 동안 하나만 둔다. 새 메시지마다 다시 만들면 재어 둔 높이가
  // 새로 잡혀, 아직 전달되지 않은 높이 변화(iOS 키보드가 닫히는 중 등)를 놓친다.
  const followThreadResize = useEffectEvent((messageThread: HTMLElement) => {
    const heightChanged =
      observedThreadHeight.current !== messageThread.clientHeight;
    observedThreadHeight.current = messageThread.clientHeight;
    if (ios && heightChanged && !followingNewMessagesRef.current) {
      const distanceFromBottom =
        messageThread.scrollHeight -
        messageThread.clientHeight -
        messageThread.scrollTop;
      if (distanceFromBottom <= 1) {
        followingNewMessagesRef.current = true;
        setShowScrollToBottom(false);
        markNewestMessageSeen();
      }
    }
    if (followingNewMessagesRef.current) {
      if (ios) {
        const bottom = Math.max(
          0,
          messageThread.scrollHeight - messageThread.clientHeight,
        );
        if (bottom - messageThread.scrollTop > 1)
          messageThread.scrollTop = bottom;
      } else {
        messageThread.scrollTop = messageThread.scrollHeight;
      }
    }
  });
  useEffect(() => {
    const messageThread = messageThreadRef.current;
    const content = threadContentRef.current;
    if (!messageThread || !content) return;
    observedThreadHeight.current = messageThread.clientHeight;
    const observer = new ResizeObserver(() =>
      followThreadResize(messageThread),
    );
    observer.observe(messageThread);
    observer.observe(content);
    return () => observer.disconnect();
  }, [messageThreadRef]);

  function maybeLoadOlderMessages() {
    const messageThread = messageThreadRef.current;
    if (!messageThread) return;
    const threshold = Math.max(
      OLDER_MESSAGES_MIN_THRESHOLD,
      messageThread.clientHeight * OLDER_MESSAGES_THRESHOLD_SCREENS,
    );
    if (messageThread.scrollTop > threshold) {
      olderLoadFailed.current = false;
      return;
    }
    if (!hasOlderMessages || loadingOlderMessages || olderLoadFailed.current)
      return;

    const anchor = {
      distanceFromBottom: messageThread.scrollHeight - messageThread.scrollTop,
      oldestMessageId,
    };
    olderAnchor.current = anchor;
    continueOlderLoad.current = true;
    void onLoadOlderMessages().then((result) => {
      if (result === "failed") olderLoadFailed.current = true;
      // 붙인 메시지가 없으면 맨 위가 바뀌지 않아 layout effect가 거두지 않으므로 여기서 버린다.
      if (result !== "loaded" && olderAnchor.current === anchor) {
        olderAnchor.current = null;
      }
    });
  }

  // 한 페이지를 붙인 뒤에도 아직 맨 위 가까이에 있으면 다음 페이지를 이어 읽는다. 스크롤할 때만
  // 판단하면 맨 위 근처에서 멈춰 기다린 사람은 다시 스크롤할 때까지 다음 페이지를 받지 못한다.
  // 페이지가 붙으면 맨 위 메시지가 바뀌고, 위 layout effect가 스크롤 자리를 되돌린 뒤에 이 effect가 돈다.
  const continueOlderLoad = useRef(false);
  const loadMoreIfStillNearTop = useEffectEvent(() => {
    if (!continueOlderLoad.current) return;
    continueOlderLoad.current = false;
    maybeLoadOlderMessages();
  });
  useEffect(() => {
    loadMoreIfStillNearTop();
  }, [oldestMessageId]);

  function updateScrollToBottomVisibility() {
    const messageThread = messageThreadRef.current;
    if (!messageThread) return;
    const distanceFromBottom =
      messageThread.scrollHeight -
      messageThread.clientHeight -
      messageThread.scrollTop;
    // Safari may emit scroll before resize delivery when the multiline composer grows.
    // Keep the previous follow state until the observer restores the bottom position,
    // but still mark a message already visible at the bottom as seen.
    if (
      ios &&
      (composingAtBottomRef.current ||
        (observedThreadHeight.current !== null &&
          observedThreadHeight.current !== messageThread.clientHeight))
    ) {
      if (distanceFromBottom <= 1) {
        markNewestMessageSeen();
      }
      return;
    }
    followingNewMessagesRef.current =
      distanceFromBottom <= FOLLOW_NEW_MESSAGES_THRESHOLD;
    if (followingNewMessagesRef.current) {
      // 맨 아래에서는 스크롤 이벤트마다 여기에 온다. 같은 값이면 이전 객체를 돌려줘 다시 그리지 않는다.
      markNewestMessageSeen();
    }

    if (scrollingToBottom.current) {
      if (
        messageThread.scrollTop < previousScrollTop.current ||
        distanceFromBottom <= BOTTOM_SCROLL_BUTTON_THRESHOLD
      ) {
        scrollingToBottom.current = false;
        setShowScrollToBottom(
          distanceFromBottom > BOTTOM_SCROLL_BUTTON_THRESHOLD,
        );
      }
      previousScrollTop.current = messageThread.scrollTop;
      return;
    }

    setShowScrollToBottom(distanceFromBottom > BOTTOM_SCROLL_BUTTON_THRESHOLD);
  }

  function scrollToBottom() {
    const messageThread = messageThreadRef.current;
    if (!messageThread) return;
    scrollingToBottom.current = true;
    previousScrollTop.current = messageThread.scrollTop;
    messageThread.scrollTo({
      top: messageThread.scrollHeight,
      behavior: "smooth",
    });
    setShowScrollToBottom(false);
  }

  return (
    <div
      className="relative isolate flex min-h-0 flex-1 flex-col"
      onDragOver={(event) => {
        if (!onDropFiles || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDraggingFiles(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDraggingFiles(false);
        }
      }}
      onDrop={(event) => {
        setDraggingFiles(false);
        if (!onDropFiles || event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        onDropFiles([...event.dataTransfer.files]);
      }}
    >
      {findingMessage || loadingOlderMessages ? (
        <div
          role="status"
          className="pointer-events-none absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur"
        >
          <Spinner />
          {findingMessage ? "메시지를 찾는 중" : "이전 메시지를 불러오는 중"}
        </div>
      ) : null}
      {draggingFiles ? (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-background/80 text-sm font-medium text-primary">
          여기에 놓으면 첨부합니다
        </div>
      ) : null}
      <div
        ref={messageThreadRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-x-desktop-auto overscroll-y-contain px-3 py-4 md:px-5"
        onPointerDown={() => {
          composingAtBottomRef.current = false;
        }}
        onScroll={() => {
          updateScrollToBottomVisibility();
          maybeLoadOlderMessages();
        }}
      >
        <div
          ref={threadContentRef}
          className={cn(
            "mx-auto flex min-h-full max-w-3xl flex-col justify-start gap-0.5",
            !desktopDetailsOpen && "xl:max-w-none",
          )}
        >
          {messages.map((message, index) => {
            const slot = layout[index];
            const sender = message.senderId
              ? participantById.get(message.senderId)
              : undefined;
            const replyTargetAuthor = message.replyTo?.senderId
              ? participantById.get(message.replyTo.senderId)?.name
              : undefined;

            return (
              <div key={message.id}>
                {slot?.startsDay ? (
                  <div className="my-4 flex items-center justify-center">
                    <span className="text-xs text-muted-foreground">
                      {formatMessageDay(message.sentAt)}
                    </span>
                  </div>
                ) : null}
                {message.system ? (
                  <p className="mx-auto my-3 w-fit max-w-[85%] rounded-xl bg-muted/60 px-3 py-1 text-center text-xs text-muted-foreground">
                    {formatSystemMessage(message.system, participantById)}
                  </p>
                ) : (
                  <ThreadMessage
                    message={message}
                    sender={sender}
                    replyTargetAuthor={replyTargetAuthor}
                    isOwn={message.senderId === conversation.viewerId}
                    canEdit={canEditMessage(message, conversation.viewerId)}
                    selection={
                      selection === null
                        ? undefined
                        : message.senderId === conversation.viewerId &&
                            !message.deleted &&
                            !message.pending &&
                            !message.failed
                          ? selection.has(message.id)
                          : null
                    }
                    isGroup={conversation.type === "group"}
                    startsGroup={slot?.startsGroup ?? true}
                    endsGroup={slot?.endsGroup ?? true}
                    highlighted={highlightedMessageId === message.id}
                    contextViewportRef={messageThreadRef}
                    contextPortalRef={contextPortalRef}
                    actions={actions}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {incomingMessage ? (
        <button
          type="button"
          aria-label={`새 메시지: ${incomingSender?.name ?? "알 수 없는 사용자"}, 맨 아래로 이동`}
          className="absolute bottom-3 left-1/2 z-10 flex w-max max-w-[min(20rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-2 rounded-full border bg-background/95 py-1.5 pr-3 pl-1.5 text-left text-sm shadow-md backdrop-blur focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={scrollToBottom}
        >
          <UserAvatar
            src={incomingSender?.avatarUrl}
            name={incomingSender?.name}
            className="size-6"
          />
          <span className="min-w-0 truncate">
            <span className="font-semibold">
              {incomingSender?.name ?? "알 수 없는 사용자"}
            </span>{" "}
            <span className="text-muted-foreground">
              {formatReplyPreview(
                toReplyPreview(incomingMessage, participantById),
                window.location.origin,
              )}
            </span>
          </span>
          <ChevronDownIcon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
        </button>
      ) : showScrollToBottom ? (
        <Button
          variant="secondary"
          size="icon"
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border-border bg-background/95 shadow-md backdrop-blur"
          aria-label="맨 아래로 이동"
          onClick={scrollToBottom}
        >
          <ChevronDownIcon aria-hidden className="size-5" />
        </Button>
      ) : null}
      <div
        ref={contextPortalRef}
        data-slot="message-context-portal"
        className="contents"
      />
    </div>
  );
}

/** 불러온 메시지를 답장 인용과 같은 모양으로 줄인다. 첨부만 있는 메시지를 첨부 종류로 부르게 한다. 멘션은 지금 이름이다. */
function toReplyPreview(
  message: ConversationMessage,
  participantById: ReadonlyMap<string, MessageParticipant>,
) {
  return {
    body: messagePlainText(message, participantById),
    deleted: message.deleted,
    attachmentKind: message.attachments?.[0]?.kind ?? null,
  };
}

/** 쉬는 시간이 지났으면 지금을 기록하고 true를 돌려준다. 이벤트 처리기에서만 부른다. */
function claimCooldown(lastAt: { current: number }): boolean {
  const now = Date.now();
  if (now - lastAt.current < SEND_COOLDOWN_MS) return false;
  lastAt.current = now;
  return true;
}

/** 고치는 중인 내 메시지와 작성창에 올릴 원문과 멘션. 실패한 수정을 되살릴 때는 입력이 원문과 다르다. */
interface EditTarget {
  message: ConversationMessage;
  draft: string;
  mentions: MentionDraftEntry[];
}

/** 고치는 동안 맡겨 둔 원래 입력. */
interface HeldDraft {
  text: string;
  mentions: MentionDraftEntry[];
}

const EMPTY_HELD_DRAFT: HeldDraft = { text: "", mentions: [] };

interface ThreadMessageActions {
  selectReaction: (
    message: ConversationMessage,
    reaction: PostReaction,
  ) => void;
  reply: (message: ConversationMessage) => void;
  togglePinned: (message: ConversationMessage) => void;
  edit: (message: ConversationMessage) => void;
  delete: (message: ConversationMessage) => void;
  viewMessage: (messageId: string) => void;
  toggleSelection: (message: ConversationMessage) => void;
  retry: (message: ConversationMessage) => void;
  discard: (message: ConversationMessage) => void;
  showReactions: (message: ConversationMessage) => void;
}

/**
 * 메시지 한 건. 긴 대화방에서 스크롤, 강조, 반응 하나가 바뀔 때마다 모든 행이 다시 그려지지 않도록
 * memo로 감싼다. 넘기는 값은 모두 원시값이거나 그대로 유지되는 참조여야 한다. `message`는 cache가
 * 바뀐 메시지만 새 객체로 바꾸고, `sender`는 대화의 참여자 객체, `actions`는 한 번 만든 객체다.
 */
const ThreadMessage = memo(function ThreadMessage({
  message,
  sender,
  replyTargetAuthor,
  isOwn,
  canEdit,
  selection,
  isGroup,
  startsGroup,
  endsGroup,
  highlighted,
  contextViewportRef,
  contextPortalRef,
  actions,
}: {
  message: ConversationMessage;
  sender?: MessageParticipant;
  replyTargetAuthor?: string;
  isOwn: boolean;
  /** 15분 기한은 렌더 시점에 판정한다. 기한이 지나면 다음 렌더에서 메뉴가 빠지고, 서버가 최종 판정한다. */
  canEdit: boolean;
  /**
   * 삭제 모드에서 이 메시지를 골랐는지. 삭제 모드가 아니면 `undefined`, 삭제 모드인데 고를 수 없는
   * 메시지(남의 메시지, 삭제된 메시지, 보내는 중이거나 보내지 못한 메시지)면 `null`이다.
   */
  selection?: boolean | null;
  isGroup: boolean;
  startsGroup: boolean;
  endsGroup: boolean;
  highlighted: boolean;
  contextViewportRef: RefObject<HTMLDivElement | null>;
  contextPortalRef: RefObject<HTMLDivElement | null>;
  actions: ThreadMessageActions;
}) {
  const replyTarget = message.replyTo;
  const participantById = useMessageParticipants();
  // 삭제된 메시지는 반응, 고정, 수정, 삭제를 받지 않는다. 전송 중인 메시지는 아직 서버에 없어
  // 복사만 된다. 남는 작업이 없으면 메뉴를 열지 않는다.
  const actionable = !message.deleted && !message.pending && !message.failed;
  const contextActions = [
    ...(actionable
      ? [
          {
            label: "답장",
            icon: <ReplyIcon aria-hidden />,
            onSelect: () => actions.reply(message),
          },
        ]
      : []),
    ...(message.deleted || message.body === ""
      ? []
      : [
          {
            label: "복사",
            icon: <CopyIcon aria-hidden />,
            onSelect: () =>
              void copyMessageText(messagePlainText(message, participantById)),
          },
        ]),
    ...(actionable
      ? [
          {
            label: message.pinned ? "고정 해제" : "고정",
            icon: <PinIcon aria-hidden />,
            onSelect: () => actions.togglePinned(message),
          },
        ]
      : []),
    ...(canEdit
      ? [
          {
            label: "수정",
            icon: <PencilIcon aria-hidden />,
            onSelect: () => actions.edit(message),
          },
        ]
      : []),
    ...(isOwn && actionable
      ? [
          {
            label: "삭제",
            icon: <Trash2Icon aria-hidden />,
            onSelect: () => actions.delete(message),
          },
        ]
      : []),
  ];

  return (
    // 삭제 모드에서 고를 수 없는 메시지(남의 메시지, 삭제된 메시지, 보내는 중이거나 보내지 못한 메시지)는
    // 흐리게 두고 반응·답장·길게 누르기를 받지 않는다. 작성창이 숨어 있어 답장 대상이 보이지 않게 생긴다.
    <div
      className={cn("relative", selection === null && "opacity-50")}
      inert={selection === null}
    >
      <MessageRow
        message={message}
        sender={sender}
        isOwn={isOwn}
        isGroup={isGroup}
        unreadParticipantCount={message.unreadMemberCount ?? 0}
        startsGroup={startsGroup}
        endsGroup={endsGroup}
        isPinned={message.pinned ?? false}
        highlighted={highlighted}
        elementId={`message-${message.id}`}
        contextViewportRef={contextViewportRef}
        contextPortalRef={contextPortalRef}
        replyTarget={replyTarget}
        replyTargetAuthor={replyTargetAuthor}
        onShowReactions={() => actions.showReactions(message)}
        onViewReply={
          replyTarget ? () => actions.viewMessage(replyTarget.id) : undefined
        }
        onReply={actionable ? () => actions.reply(message) : undefined}
        onSelectReaction={
          actionable
            ? (reaction) => actions.selectReaction(message, reaction)
            : undefined
        }
        contextActions={contextActions.length ? contextActions : undefined}
        actionRail={
          <MessageActions
            isOwn={isOwn}
            message={message}
            isPinned={message.pinned ?? false}
            onSelectReaction={(reaction) =>
              actions.selectReaction(message, reaction)
            }
            onReply={() => actions.reply(message)}
            onTogglePinned={() => actions.togglePinned(message)}
            onEdit={canEdit ? () => actions.edit(message) : undefined}
            onDelete={
              isOwn && actionable ? () => actions.delete(message) : undefined
            }
          />
        }
      />
      {message.failed ? (
        <div className="mt-0.5 mb-1 flex items-center justify-end gap-1 text-xs">
          <span className="text-destructive">보내지 못했습니다</span>
          <Button
            variant="ghost"
            size="xs"
            // 누를 자리를 위아래로 넓힌다. 옆 버튼과 겹치지 않게 좌우는 그대로 둔다.
            className="relative after:absolute after:inset-x-0 after:-inset-y-2"
            onClick={() => actions.retry(message)}
          >
            다시 보내기
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="relative text-muted-foreground after:absolute after:inset-x-0 after:-inset-y-2"
            onClick={() => actions.discard(message)}
          >
            지우기
          </Button>
        </div>
      ) : null}
      {selection === undefined || selection === null ? null : (
        // 삭제 모드에서는 행 전체가 고르기 버튼이다. 메뉴와 길게 누르기는 막는다.
        <button
          type="button"
          aria-label={selection ? "메시지 선택 해제" : "메시지 선택"}
          aria-pressed={selection}
          className="absolute inset-0 z-10 flex items-center rounded-lg pl-1 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => actions.toggleSelection(message)}
        >
          <span
            aria-hidden
            className={cn(
              "flex size-5 items-center justify-center rounded-full border-2",
              selection
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground bg-background",
            )}
          >
            {selection ? <CheckIcon className="size-3" /> : null}
          </span>
        </button>
      )}
    </div>
  );
});

function MessageActions({
  isOwn,
  message,
  isPinned,
  onSelectReaction,
  onReply,
  onTogglePinned,
  onEdit,
  onDelete,
}: {
  isOwn: boolean;
  message: ConversationMessage;
  isPinned: boolean;
  onSelectReaction: (reaction: PostReaction) => void;
  onReply: () => void;
  onTogglePinned: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [reactionOpen, setReactionOpen] = useState(false);
  const participantById = useMessageParticipants();

  const reactionAction = (
    <div className="relative flex shrink-0">
      {reactionOpen ? (
        <ReactionPickerSurface
          onDismiss={() => setReactionOpen(false)}
          className="left-1/2 mb-2 -translate-x-1/2"
        >
          <QuickReactionBar
            current={message.myReaction}
            onSelect={(reaction) => {
              setReactionOpen(false);
              onSelectReaction(reaction);
            }}
          />
        </ReactionPickerSurface>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-full text-muted-foreground"
        aria-label="메시지에 반응"
        aria-expanded={reactionOpen}
        onClick={() => setReactionOpen((open) => !open)}
      >
        <SmileIcon aria-hidden />
      </Button>
    </div>
  );
  const replyAction = (
    <Button
      variant="ghost"
      size="icon-sm"
      className="rounded-full text-muted-foreground"
      aria-label="메시지에 답장"
      onClick={onReply}
    >
      <ReplyIcon aria-hidden />
    </Button>
  );
  const moreAction = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground"
            aria-label="메시지 기타 작업"
          />
        }
      >
        <EllipsisIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="center"
        className="shadow-sm duration-0 data-open:animate-none data-closed:animate-none"
      >
        <DropdownMenuGroup>
          {/* 첨부만 있는 메시지는 복사할 글이 없다. 길게 누르기 메뉴와 같다. */}
          {message.body !== "" ? (
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={() =>
                void copyMessageText(messagePlainText(message, participantById))
              }
            >
              <CopyIcon aria-hidden />
              복사
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem className="cursor-pointer" onClick={onTogglePinned}>
            <PinIcon aria-hidden />
            {isPinned ? "고정 해제" : "고정"}
          </DropdownMenuItem>
          {onEdit ? (
            <DropdownMenuItem className="cursor-pointer" onClick={onEdit}>
              <PencilIcon aria-hidden />
              수정
            </DropdownMenuItem>
          ) : null}
          {onDelete ? (
            <DropdownMenuItem
              className="cursor-pointer"
              variant="destructive"
              onClick={onDelete}
            >
              <Trash2Icon aria-hidden />
              삭제
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // 삭제된 메시지에는 할 수 있는 작업이 없고, 전송 중인 메시지는 아직 서버에 없다.
  if (message.deleted || message.pending || message.failed) return null;

  return (
    <MessageActionRail>
      {isOwn ? (
        <>
          {moreAction}
          {replyAction}
          {reactionAction}
        </>
      ) : (
        <>
          {reactionAction}
          {replyAction}
          {moreAction}
        </>
      )}
    </MessageActionRail>
  );
}

/**
 * 메시지를 대화 영역 가운데로 옮긴다. `scrollIntoView`는 스크롤 조상을 전부 밀어, 원문이 맨 위나 맨 아래
 * 근처라 대화 영역만으로 가운데에 못 오면 `overflow-hidden`인 대화방과 앱 셸까지 밀어 버린다. 그러면
 * 화면 전체가 밀리고 아래에 빈 영역이 생기므로 대화 영역 안에서만 움직인다.
 */
function centerInThread(messageThread: HTMLElement, target: HTMLElement) {
  const threadRect = messageThread.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const top =
    messageThread.scrollTop +
    (targetRect.top - threadRect.top) -
    (messageThread.clientHeight - targetRect.height) / 2;
  messageThread.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

/** 작성창 위에 쌓아 둔 첨부 하나. 사진은 기기 안의 미리보기를 함께 든다. */
interface StagedAttachment {
  id: string;
  file: File;
  previewUrl: string | null;
}

function toStagedAttachment(file: File): StagedAttachment {
  return {
    id: randomUUID(),
    file,
    previewUrl:
      classifyAttachment(file) === "image" ? URL.createObjectURL(file) : null,
  };
}

function ComposerShell({
  onDraftInput,
  keyboardOpenOnIOS,
  replyTarget,
  replyAuthor,
  onCancelReply,
  editTarget,
  onCancelEdit,
  onEdit,
  onSend,
  staged,
  onStageFiles,
  onUnstage,
  onSendStaged,
  onSendFiles,
  desktopDetailsOpen,
  draftKey,
  mentionParticipants,
  viewerId,
}: {
  onDraftInput: () => void;
  keyboardOpenOnIOS: boolean;
  replyTarget?: ConversationMessage;
  replyAuthor: string | null;
  onCancelReply: () => void;
  /** 고치는 중인 내 메시지. 작성창이 그 입력으로 바뀌고, 보내면 `onEdit`을 부른다. */
  editTarget?: EditTarget;
  onCancelEdit: () => void;
  onEdit: (message: PreparedMessageMentions) => Promise<void>;
  /** 보내지 못한 메시지는 목록에 남아 다시 보낼 수 있으므로 작성창은 입력을 되살리지 않는다. */
  onSend: (message: PreparedMessageMentions) => Promise<boolean>;
  /** 끌어 놓거나 붙여 넣어 쌓아 둔 첨부. 전송하면 글 다음에 함께 보낸다. */
  staged: StagedAttachment[];
  onStageFiles: (files: File[]) => void;
  onUnstage: (id: string) => void;
  onSendStaged: () => void;
  /** 고른 파일을 보낸다. 답장이나 수정 중에는 첨부할 수 없다(기능 명세 §13.5). */
  onSendFiles: (files: File[]) => void;
  desktopDetailsOpen: boolean;
  /** 쓰던 글을 맡겨 둘 자리. 다른 방에 다녀오거나 삭제 모드를 마치고 돌아오면 되살린다. */
  draftKey: string;
  /** 멘션 후보가 될 대화 참여자. 1:1 대화처럼 멘션이 없으면 `null`이다. */
  mentionParticipants: MessageParticipant[] | null;
  viewerId: string;
}) {
  // 입력창이 드는 값은 원문이 아니라 표시형(`@홍길동`)이고, 멘션 대상은 따로 든다. 원문은 제출과
  // 검사에만 쓴다(`prepareMessageMentions()`).
  const [draft, setDraft] = useState(() => readRoomDraft(draftKey)?.text ?? "");
  const [mentions, setMentions] = useState<MentionDraftEntry[]>(
    () => readRoomDraft(draftKey)?.mentions ?? [],
  );
  // 보낸 직후 잠시 전송을 받지 않는다. 버튼을 껐다 켜면 깜박이므로 누름만 버리고, 입력은 그대로
  // 두어 이어서 보낼 수 있다.
  const lastSentAt = useRef(0);
  // 방금 글이나 첨부를 보냈는지. 버튼 모양은 바로 좋아요로 바뀌지만 그동안의 누름은 좋아요를 보내지 않는다.
  const [justSent, setJustSent] = useState(false);
  useEffect(() => {
    if (!justSent) return;
    const timeout = window.setTimeout(
      () => setJustSent(false),
      LIKE_AFTER_SEND_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [justSent]);
  const claimSend = () => claimCooldown(lastSentAt);
  const mediaInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachDisabled = Boolean(replyTarget ?? editTarget);
  const pickFiles = (input: HTMLInputElement) => {
    const files = [...(input.files ?? [])];
    // 같은 파일을 다시 고를 수 있게 비운다.
    input.value = "";
    if (files.length > 0) onSendFiles(files);
  };
  // 고치기를 시작하면 쓰던 입력을 맡겨 두고 메시지 본문을 올린다. 끝나면 맡긴 입력을 되돌린다.
  const [editingId, setEditingId] = useState<string | undefined>();
  const [held, setHeld] = useState<HeldDraft>(EMPTY_HELD_DRAFT);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const refocusAfterSend = useRef(false);
  if (editTarget?.message.id !== editingId) {
    setEditingId(editTarget?.message.id);
    if (editTarget) {
      if (editingId === undefined) setHeld({ text: draft, mentions });
      setDraft(toMentionDisplay(editTarget.draft, editTarget.mentions));
      setMentions(editTarget.mentions);
    } else {
      setDraft(held.text);
      setMentions(held.mentions);
      setHeld(EMPTY_HELD_DRAFT);
    }
  }
  useEffect(() => {
    if (editingId) textareaRef.current?.focus();
  }, [editingId]);
  // 고치는 중이면 맡겨 둔 원래 입력을 남긴다. 고치던 본문은 초안이 아니다.
  const savedText = editTarget ? held.text : draft;
  const savedMentions = editTarget ? held.mentions : mentions;
  useEffect(() => {
    updateRoomDraft(draftKey, { text: savedText, mentions: savedMentions });
  }, [draftKey, savedText, savedMentions]);
  // 답장을 시작하면 바로 쓸 수 있게 입력창으로 간다.
  const replyingId = replyTarget?.id;
  useEffect(() => {
    if (replyingId) textareaRef.current?.focus();
  }, [replyingId]);
  // 방에 들어오면 바로 칠 수 있게 입력창으로 간다. 폰·태블릿은 화면 키보드가 대화를 덮으므로 두지
  // 않는다. 되살린 초안이 있으면 그 끝에서 이어 쓴다.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || isHandheld()) return;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);
  const [attachmentActionsExpanded, setAttachmentActionsExpanded] =
    useState(false);
  const isSendEnter = useIsSendEnter();
  const prepared = useMemo(
    () => prepareMessageMentions(normalizeMessageBody(draft), mentions),
    [draft, mentions],
  );
  const hasDraft = prepared.body.trim() !== "";
  // 수정 중에는 첨부를 쌓지 않는다. 고칠 수 있는 메시지는 본문뿐이다. 답장에도 첨부하지 않는다
  // (기능 명세 §13.5). 쌓아 둔 첨부는 그동안 숨겨 두었다가 끝나면 다시 보인다.
  const canStage = !editTarget && !replyTarget;
  const hasStaged = canStage && staged.length > 0;
  // 길이 상한은 저장되는 원문에 걸린다. 화면에 보이는 글자 수로 세면 토큰 길이만큼 넘겨 보낸다.
  const draftLength = countMessageGraphemes(prepared.body);
  const overLimit = draftLength > MESSAGE_MAX_LENGTH;
  const mentionLimitReason = mentionCountReason(prepared.mentionPubIds.length);
  const cannotSend = overLimit || mentionLimitReason !== null;
  const attachmentActionsCollapsed = hasDraft && !attachmentActionsExpanded;

  function changeDraft(value: string) {
    onDraftInput();
    setDraft(value);
    setJustSent(false);
    if (normalizeMessageBody(value).trim() === "") {
      setAttachmentActionsExpanded(false);
    }
  }

  const mentionInput = useMentionTextarea({
    inputRef: textareaRef,
    draft,
    setDraft: changeDraft,
    entries: mentions,
  });
  const participantById = useMessageParticipants();
  const mentionSuggestions = useMentionSuggestions({
    participants: mentionParticipants,
    viewerId,
  });
  const mentionListId = useId();
  const mentionArea = useRef<HTMLDivElement>(null);
  const closeMentionSuggestions = mentionSuggestions.close;
  // 입력창이나 후보 밖을 누르면 닫는다. blur로 닫으면 iOS에서 후보를 누르는 순간 입력창이 포커스를
  // 잃어 목록이 먼저 사라지고 누른 후보가 들어가지 않는다.
  useEffect(() => {
    if (!mentionSuggestions.open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!mentionArea.current?.contains(event.target as Node)) {
        closeMentionSuggestions();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [mentionSuggestions.open, closeMentionSuggestions]);

  /** 고른 후보를 `@`와 이어 친 글자 자리에 넣는다. 뒤에 공백 하나를 붙여 바로 이어 쓰게 한다. */
  function selectMention(suggestion: MessageMentionSuggestion) {
    const element = textareaRef.current;
    const trigger = mentionSuggestions.trigger;
    mentionSuggestions.close();
    if (!element || trigger === null) return;
    // 번호는 원문의 토큰을 보고 고른다. 표시형에는 토큰이 없어 언제나 1이 나온다.
    const added = addMessageMention(
      mentions,
      suggestion,
      fromMentionDisplay(draft, mentions),
    );
    if (!added) return;
    setMentions(added.entries);
    mentionInput.replaceRange(
      trigger,
      element.selectionStart,
      `${mentionDisplayText(added.entry.name, added.entry.ordinal)} `,
    );
  }

  function sendDraft(): boolean {
    if (cannotSend) return false;
    mentionSuggestions.close();
    if (editTarget) {
      if (!hasDraft) return false;
      void onEdit(prepared);
      return true;
    }
    if (!hasDraft && !hasStaged) return false;
    if (!claimSend()) return false;
    // 글을 먼저 보낸다. 첨부는 올리기가 끝나야 서버 시각이 정해지므로 어차피 글 뒤에 온다.
    if (hasDraft) {
      void onSend(prepared);
      setDraft("");
      setMentions([]);
    }
    if (hasStaged) onSendStaged();
    setAttachmentActionsExpanded(false);
    setJustSent(true);
    return true;
  }

  return (
    <footer
      className={cn(
        "shrink-0 bg-background px-2 pt-2 md:px-3 md:pb-3",
        // iOS는 키보드가 떠도 safe-area-inset-bottom을 남긴다. 이미 키보드 위에
        // 놓인 입력창에는 홈 인디케이터 여백을 더하지 않는다.
        keyboardOpenOnIOS ? "pb-0" : "pb-[calc(0.5rem+var(--app-safe-b))]",
      )}
      onDragOver={(event) => {
        if (canStage && event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        if (!canStage || event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        onStageFiles([...event.dataTransfer.files]);
      }}
    >
      {editTarget ? (
        <div
          className={cn(
            "mx-auto mb-2 flex max-w-3xl items-center gap-2 border-l-2 border-primary px-3 py-1",
            !desktopDetailsOpen && "xl:max-w-none",
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-primary">메시지 수정</p>
            <p className="truncate text-xs text-muted-foreground">
              {messagePlainText(editTarget.message, participantById)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            // 보이는 크기는 작게 두고 누를 자리만 44px로 넓힌다.
            className="relative rounded-full after:absolute after:-inset-2.5"
            aria-label="수정 취소"
            onClick={onCancelEdit}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
      ) : null}
      {replyTarget ? (
        <div
          className={cn(
            "mx-auto mb-2 flex max-w-3xl items-center gap-2 border-l-2 border-primary px-3 py-1",
            !desktopDetailsOpen && "xl:max-w-none",
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-primary">
              {replyAuthor ?? "알 수 없는 사용자"}에게 답장
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {formatReplyPreview(
                toReplyPreview(replyTarget, participantById),
                window.location.origin,
              )}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            className="relative rounded-full after:absolute after:-inset-2.5"
            aria-label="답장 취소"
            onClick={onCancelReply}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
      ) : null}
      {hasStaged ? (
        <ul
          aria-label="보낼 첨부"
          className={cn(
            // 작성창과 구분되도록 옅은 판 위에 늘어놓는다. 위쪽 여백은 빼기 버튼이 잘리지 않을 자리다.
            "mx-auto mb-2 flex max-w-3xl gap-2 overflow-x-auto rounded-2xl bg-muted/70 px-2.5 pt-3 pb-2.5",
            !desktopDetailsOpen && "xl:max-w-none",
          )}
        >
          {staged.map((item) => (
            <li key={item.id} className="relative shrink-0">
              {item.previewUrl ? (
                <img
                  src={item.previewUrl}
                  alt={item.file.name}
                  className="size-16 rounded-xl bg-background object-cover ring-1 ring-border"
                />
              ) : (
                <div className="flex h-16 w-44 items-center gap-2 rounded-xl bg-background px-3 ring-1 ring-border">
                  <FileIcon
                    aria-hidden
                    className="size-5 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-xs">
                      {item.file.name}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {formatFileSize(item.file.size)}
                    </span>
                  </span>
                </div>
              )}
              <Button
                type="button"
                size="icon-xs"
                variant="secondary"
                aria-label={`첨부 빼기: ${item.file.name}`}
                className="absolute -top-1.5 -right-1.5 rounded-full shadow-sm after:absolute after:-inset-2.5"
                onClick={() => onUnstage(item.id)}
              >
                <XIcon aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div
        ref={mentionArea}
        className={cn(
          "relative mx-auto flex max-w-3xl items-end gap-1.5",
          !desktopDetailsOpen && "xl:max-w-none",
        )}
      >
        {mentionSuggestions.open ? (
          <MentionSuggestionList
            id={mentionListId}
            suggestions={mentionSuggestions.suggestions}
            activeIndex={mentionSuggestions.activeIndex}
            onActiveIndexChange={mentionSuggestions.setActiveIndex}
            onSelect={selectMention}
            className="absolute inset-x-0 bottom-full z-20 mb-2"
          />
        ) : null}
        <div
          aria-hidden={attachmentActionsCollapsed}
          className={cn(
            "flex shrink-0 items-end gap-1.5 transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none",
            attachmentActionsCollapsed
              ? "w-0 overflow-hidden opacity-0"
              : "w-[5.5rem] opacity-100",
          )}
        >
          <input
            ref={mediaInput}
            type="file"
            accept={IMAGE_INPUT_ACCEPT}
            multiple
            hidden
            aria-hidden
            tabIndex={-1}
            onChange={(event) => pickFiles(event.currentTarget)}
          />
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            aria-hidden
            tabIndex={-1}
            onChange={(event) => pickFiles(event.currentTarget)}
          />
          <Button
            variant="ghost"
            size="icon"
            className="mb-0.5 rounded-full"
            aria-label="파일 보내기"
            disabled={attachDisabled}
            onClick={() => fileInput.current?.click()}
          >
            <PaperclipIcon aria-hidden className="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="mb-0.5 rounded-full"
            aria-label="사진 보내기"
            disabled={attachDisabled}
            onClick={() => mediaInput.current?.click()}
          >
            <ImageIcon aria-hidden className="size-5" />
          </Button>
        </div>
        {attachmentActionsCollapsed ? (
          <Button
            variant="ghost"
            size="icon"
            className="mb-0.5 shrink-0 rounded-full"
            aria-label="첨부 메뉴 펼치기"
            onClick={() => setAttachmentActionsExpanded(true)}
          >
            <ChevronRightIcon aria-hidden className="size-5" />
          </Button>
        ) : null}
        <div className="flex min-h-10 min-w-0 flex-1 items-end gap-2 rounded-3xl bg-muted py-2 pr-3 pl-4">
          <div className="grid min-w-0 flex-1">
            <MentionHighlight
              text={draft}
              ranges={mentionInput.mentionRanges}
              inputRef={textareaRef}
              className={MESSAGE_INPUT_TEXT_CLASS}
            />
            <textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              aria-label="메시지 입력"
              placeholder="메시지 입력"
              aria-autocomplete={mentionParticipants ? "list" : undefined}
              aria-controls={
                mentionSuggestions.open ? mentionListId : undefined
              }
              aria-activedescendant={
                mentionSuggestions.open
                  ? mentionOptionId(
                      mentionListId,
                      mentionSuggestions.activeIndex,
                    )
                  : undefined
              }
              className={cn(
                // 너비를 고정해 `field-sizing-content`가 높이만 맞추게 한다. 너비까지 글에 맞추면 키를 칠
                // 때마다 바깥 레이아웃을 다시 잡아, 대화와 목록이 함께 놓이는 데스크톱에서 입력이 늦게 보인다.
                "col-start-1 row-start-1 field-sizing-content min-h-6 w-full min-w-0 resize-none overflow-y-auto bg-transparent text-foreground outline-none placeholder:text-muted-foreground",
                MESSAGE_INPUT_TEXT_CLASS,
                mentionInput.mentionRanges.length > 0 &&
                  MENTION_HIGHLIGHT_INPUT_CLASS,
              )}
              onChange={(event) => {
                const element = event.currentTarget;
                mentionSuggestions.onTextChange(
                  draft,
                  element.value,
                  element.selectionStart,
                  mentionInput.composing.current,
                );
                mentionInput.handleChange(element);
              }}
              onSelect={(event) => {
                // 조합 중에는 캐럿이 조합하던 글자를 따라 움직일 뿐이다. 조합이 끝나면 다시 본다.
                if (mentionInput.composing.current) return;
                mentionSuggestions.onCaretMove(
                  event.currentTarget.value,
                  event.currentTarget.selectionStart,
                );
              }}
              onPaste={(event) => {
                if (!canStage) return;
                const images = clipboardImageFiles(event.clipboardData);
                if (images.length === 0) return;
                event.preventDefault();
                onStageFiles(images);
              }}
              onCompositionStart={mentionInput.handleCompositionStart}
              onCompositionEnd={(event) => {
                const element = event.currentTarget;
                mentionInput.handleCompositionEnd(element);
                // 조합 중에는 맞는 후보가 없어도 닫지 않았다. 확정한 글자로 다시 찾는다.
                mentionSuggestions.onCaretMove(
                  element.value,
                  element.selectionStart,
                );
              }}
              onKeyDown={(event) => {
                const composingText =
                  mentionInput.composing.current ||
                  event.nativeEvent.isComposing ||
                  event.keyCode === 229;
                if (mentionSuggestions.open && !composingText) {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    mentionSuggestions.move(event.key === "ArrowDown" ? 1 : -1);
                    return;
                  }
                  // 보내는 `Enter`만 고른다. 줄바꿈 `Enter`는 줄이 바뀌어 목록이 닫힌다.
                  const enter = isSendEnter(event);
                  // `@`만 치고 고른 것이 없으면 목록을 닫고 평소처럼 보낸다.
                  if (enter && !mentionSuggestions.enterSelects) {
                    mentionSuggestions.close();
                  } else if (event.key === "Tab" || enter) {
                    event.preventDefault();
                    selectMention(
                      mentionSuggestions.suggestions[
                        mentionSuggestions.activeIndex
                      ],
                    );
                    return;
                  }
                  // 수정이나 답장보다 목록을 먼저 닫는다.
                  if (event.key === "Escape") {
                    event.preventDefault();
                    mentionSuggestions.close();
                    return;
                  }
                }
                // 조합 중 Esc는 IME가 조합을 취소하는 키다. 수정이나 답장을 취소하지 않는다.
                if (
                  event.key === "Escape" &&
                  (editTarget ?? replyTarget) &&
                  !composingText
                ) {
                  event.preventDefault();
                  if (editTarget) onCancelEdit();
                  else onCancelReply();
                  return;
                }
                // 화면 키보드와 설정을 끈 기기의 Enter는 줄바꿈이다.
                if (!isSendEnter(event)) return;
                // Safari는 compositionend를 Enter keydown보다 먼저 보내 isComposing도 false다.
                // 그 keydown은 keyCode 229로 온다.
                if (composingText) return;
                event.preventDefault();
                sendDraft();
              }}
            />
          </div>
        </div>
        <Button
          variant="ghost"
          // 입력창 최소 높이(40px)와 같은 크기다. 가장 자주 누르는 버튼이라 옆 첨부 버튼보다 크게 둔다.
          size="icon-lg"
          className="shrink-0 rounded-full text-primary"
          aria-label={
            editTarget
              ? "수정한 메시지 저장"
              : hasDraft || hasStaged
                ? "메시지 보내기"
                : "좋아요 보내기"
          }
          disabled={cannotSend || (editTarget !== undefined && !hasDraft)}
          // 보내도 키보드가 접히지 않게 한다. 누르는 순간 입력창이 포커스를 잃지 않도록 기본 동작을
          // 막고, 그래도 잃는 브라우저(iOS Safari)를 위해 입력 중이었으면 누른 뒤 다시 돌려준다.
          onPointerDown={() => {
            refocusAfterSend.current =
              document.activeElement === textareaRef.current;
          }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (refocusAfterSend.current) textareaRef.current?.focus();
            if (hasDraft || hasStaged || editTarget) {
              sendDraft();
              return;
            }
            if (justSent) return;
            if (!claimSend()) return;
            void onSend({
              body: "👍",
              mentionPubIds: [],
              mentionsEveryone: false,
              entries: [],
            });
            // 공백만 있던 입력은 좋아요와 함께 비운다.
            setDraft("");
            setMentions([]);
          }}
        >
          {hasDraft || hasStaged || editTarget ? (
            <SendIcon aria-hidden className="size-6" />
          ) : (
            <ThumbsUpIcon aria-hidden className="size-6" />
          )}
        </Button>
      </div>
      {overLimit ? (
        <p
          role="alert"
          className={cn(
            "mx-auto mt-1 max-w-3xl px-3 text-xs text-destructive",
            !desktopDetailsOpen && "xl:max-w-none",
          )}
        >
          메시지는 {MESSAGE_MAX_LENGTH.toLocaleString("ko-KR")}자까지 쓸 수
          있습니다. ({draftLength.toLocaleString("ko-KR")})
        </p>
      ) : mentionLimitReason ? (
        <p
          role="alert"
          className={cn(
            "mx-auto mt-1 max-w-3xl px-3 text-xs text-destructive",
            !desktopDetailsOpen && "xl:max-w-none",
          )}
        >
          {mentionLimitReason}
        </p>
      ) : null}
    </footer>
  );
}

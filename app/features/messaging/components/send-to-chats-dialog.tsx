import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SearchIcon, XIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  Centered,
  ChoiceRow,
} from "~/features/messaging/components/choice-row";
import { ConversationAvatar } from "~/features/messaging/components/conversation-avatar";
import {
  conversationListQuery,
  invalidateConversationList,
  messagingKeys,
} from "~/features/messaging/data/cache";
import {
  SEND_TARGET_LIMIT,
  sendToConversations,
  type SendTarget,
} from "~/features/messaging/data/mutations";
import { searchMessageRecipients } from "~/features/messaging/data/queries";
import type { MessageAttachment } from "~/features/messaging/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";
import { canSendToConversation } from "~/features/messaging/model/system-message";

/** 모바일에서는 화면 아래에 붙는 시트로, 그보다 넓으면 가운데 대화상자로 띄운다. */
const SHEET_CLASS =
  "flex max-h-[min(40rem,90dvh)] flex-col gap-3 sm:max-w-md max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-t-2xl max-md:rounded-b-none max-md:pb-[max(1.5rem,env(safe-area-inset-bottom))] max-md:data-open:zoom-in-100 max-md:data-open:slide-in-from-bottom-4 max-md:data-closed:zoom-out-100 max-md:data-closed:slide-out-to-bottom-4";

interface Choice {
  key: string;
  target: SendTarget;
  name: string;
}

/**
 * 같은 본문을 고른 대화마다 메시지 하나로 보내는 시트. 게시물 보내기와 메시지 전달이 함께 쓴다. 최근
 * 대화를 먼저 보여 주고, 검색하면 사람을 찾는다.
 */
export function SendToChatsDialog({
  open,
  onOpenChange,
  content,
  subject,
  options,
  empty = false,
  contentKey = "",
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * 보낼 본문과 Storage 안에서 복사해 붙일 첨부. 보내는 순간에 만든다 — render 중에 `window`를 읽지
   * 않게 한다. 보낼 것이 없으면 `null`이다.
   */
  content: () => {
    body: string;
    attachments?: readonly MessageAttachment[];
  } | null;
  /** 알림 문구의 대상(`게시물`, `메시지`). */
  subject: string;
  /** 대상 목록 위에 둘, 무엇을 보낼지 고르는 컨트롤. */
  options?: ReactNode;
  /** `options`에서 아무것도 고르지 않아 보낼 것이 없다. 보내기 버튼을 끈다. */
  empty?: boolean;
  /**
   * 보낼 내용을 가르는 값. 바뀌면 대화별 메시지 ID를 새로 만든다. 같은 ID로 다른 내용을 다시 보내면
   * 응답만 잃고 저장됐던 대화에는 앞의 내용이 남은 채 보낸 것으로 센다.
   */
  contentKey?: string;
  /** 보내기 버튼 아래에 둘 다른 작업. `close`는 시트를 비우고 닫는다. */
  footer?: (close: () => void) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selected, setSelected] = useState<Choice[]>([]);
  const [sending, setSending] = useState(false);
  // 시트가 열려 있는 동안 대화별 메시지 ID를 기억해, 다시 보내기가 같은 본문을 두 번 저장하지 않게 한다.
  // 시트를 닫거나 보낼 내용이 바뀌면 새로 시작한다. 닫는 함수는 footer에 넘어가 render 중에 ref를 건드릴
  // 수 없으므로, 닫을 때는 회차만 올리고 보낼 때 회차와 내용을 비교해 새 Map을 만든다.
  const [session, setSession] = useState(0);
  const messageIds = useRef({ key: "", ids: new Map<string, string>() });

  const conversations = useQuery({ ...conversationListQuery(), enabled: open });
  const people = useQuery({
    queryKey: messagingKeys.recipients(searchTerm),
    queryFn: () => searchMessageRecipients(searchTerm),
    enabled: open && searchTerm !== "",
    staleTime: 30_000,
  });

  function reset() {
    setSession((current) => current + 1);
    setQuery("");
    setSearchTerm("");
    setSelected([]);
  }

  function close() {
    reset();
    onOpenChange(false);
  }

  function toggle(choice: Choice) {
    setSelected((current) =>
      current.some(({ key }) => key === choice.key)
        ? current.filter(({ key }) => key !== choice.key)
        : [...current, choice],
    );
  }

  async function send() {
    const message = content();
    if (selected.length === 0 || sending || !message) return;
    const key = `${session}:${contentKey}`;
    if (messageIds.current.key !== key) {
      messageIds.current = { key, ids: new Map() };
    }
    setSending(true);
    try {
      const { sent, failed } = await sendToConversations(
        selected.map(({ target }) => target),
        message.body,
        messageIds.current.ids,
        message.attachments,
      );
      void invalidateConversationList(queryClient);
      if (failed === 0) {
        toast.success(`${subject}를 보냈습니다.`);
        close();
      } else if (sent > 0) {
        toast.error(`${failed}곳에 보내지 못했습니다.`);
        close();
      } else {
        // 아무 데도 가지 않았으면 고른 대상을 두고 다시 시도하게 한다.
        toast.error(`${subject}를 보내지 못했습니다.`);
      }
    } finally {
      setSending(false);
    }
  }

  // 입력 중에는 최근 대화를 이름으로 걸러 보여 준다. 사람 검색은 Enter로 한다.
  const filter = query.trim().toLowerCase();
  const recent = (conversations.data ?? []).filter(
    (conversation) =>
      canSendToConversation(conversation) &&
      (filter === "" || conversation.name.toLowerCase().includes(filter)),
  );
  const isChosen = (key: string) => selected.some((item) => item.key === key);
  const full = selected.length >= SEND_TARGET_LIMIT;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className={SHEET_CLASS}>
        <DialogHeader>
          <DialogTitle>보내기</DialogTitle>
          <DialogDescription className="sr-only">
            {subject}를 보낼 채팅이나 사람을 고르세요.
          </DialogDescription>
        </DialogHeader>

        {options}

        {selected.length > 0 ? (
          <ul aria-label="고른 대상" className="flex flex-wrap gap-1.5">
            {selected.map((choice) => (
              <li key={choice.key}>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 rounded-full pr-1.5"
                  aria-label={`${choice.name} 선택 해제`}
                  onClick={() => toggle(choice)}
                >
                  {choice.name}
                  <XIcon aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {full ? (
          <p role="status" className="text-xs text-muted-foreground">
            한 번에 {SEND_TARGET_LIMIT}곳까지 보낼 수 있습니다.
          </p>
        ) : null}

        <form
          role="search"
          className="relative"
          onSubmit={(event) => {
            event.preventDefault();
            setSearchTerm(query.trim());
          }}
        >
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            enterKeyHint="search"
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              if (event.currentTarget.value.trim() === "") setSearchTerm("");
            }}
            placeholder="채팅 또는 사람 찾기"
            aria-label="채팅 또는 사람 찾기"
            className="rounded-full pl-9"
          />
        </form>

        <div className="min-h-40 flex-1 overflow-y-auto overscroll-x-desktop-auto overscroll-y-contain">
          {searchTerm !== "" ? (
            people.isPending ? (
              <Centered>
                <Spinner />
              </Centered>
            ) : people.isError ? (
              <Centered role="alert" className="text-destructive">
                검색 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
              </Centered>
            ) : people.data.length === 0 ? (
              <Centered>일치하는 사람이 없습니다.</Centered>
            ) : (
              <ul aria-label="찾은 사람" className="flex flex-col gap-0.5">
                {people.data.map((person) => {
                  const choice: Choice = {
                    key: `person:${person.id}`,
                    target: { type: "person", profileId: person.id },
                    name: person.name,
                  };
                  return (
                    <ChoiceRow
                      key={choice.key}
                      chosen={isChosen(choice.key)}
                      disabled={full && !isChosen(choice.key)}
                      onToggle={() => toggle(choice)}
                      avatar={
                        <UserAvatar
                          src={person.avatarUrl}
                          name={person.name}
                          size="lg"
                        />
                      }
                      name={person.name}
                      description={person.description}
                    />
                  );
                })}
              </ul>
            )
          ) : conversations.isPending ? (
            <Centered>
              <Spinner />
            </Centered>
          ) : recent.length === 0 ? (
            <Centered>
              {filter === ""
                ? "최근 채팅이 없습니다. 이름으로 사람을 찾아보세요."
                : "Enter를 눌러 사람을 찾아보세요."}
            </Centered>
          ) : (
            <ul aria-label="최근 채팅" className="flex flex-col gap-0.5">
              {recent.map((conversation) => {
                const choice: Choice = {
                  key: `conversation:${conversation.id}`,
                  target: {
                    type: "conversation",
                    conversationId: conversation.id,
                  },
                  name: conversation.name,
                };
                return (
                  <ChoiceRow
                    key={choice.key}
                    chosen={isChosen(choice.key)}
                    disabled={full && !isChosen(choice.key)}
                    onToggle={() => toggle(choice)}
                    avatar={
                      <ConversationAvatar
                        conversation={conversation}
                        className="size-10"
                      />
                    }
                    name={conversation.name}
                    description={
                      conversation.type === "group"
                        ? `그룹 · ${conversation.participants.filter(({ active }) => active).length}명`
                        : undefined
                    }
                  />
                );
              })}
            </ul>
          )}
        </div>

        <Button
          type="button"
          className="w-full"
          disabled={selected.length === 0 || sending || empty}
          onClick={() => void send()}
        >
          {sending ? <Spinner data-icon="inline-start" /> : null}
          {selected.length > 1 ? `${selected.length}곳에 보내기` : "보내기"}
        </Button>

        {footer ? (
          <div className="-mx-6 flex justify-center gap-2 border-t px-6 pt-3">
            {footer(close)}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

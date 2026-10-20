import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  LinkIcon,
  SearchIcon,
  ShareIcon,
  XIcon,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { conversationProfileName } from "~/features/messaging/model/conversation-preview";
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
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";
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

/** 운영체제 공유 시트를 여는 기기. 폰·태블릿은 다른 앱으로 바로 이어지고, 데스크톱은 링크 복사가 더 빠르다. */
const NATIVE_SHARE_QUERY = "(hover: none) and (pointer: coarse)";

/** 모바일에서는 화면 아래에 붙는 시트로, 그보다 넓으면 가운데 대화상자로 띄운다. */
const SHEET_CLASS =
  "flex max-h-[min(40rem,90dvh)] flex-col gap-3 sm:max-w-md max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-t-2xl max-md:rounded-b-none max-md:pb-[max(1.5rem,env(safe-area-inset-bottom))] max-md:data-open:zoom-in-100 max-md:data-open:slide-in-from-bottom-4 max-md:data-closed:zoom-out-100 max-md:data-closed:slide-out-to-bottom-4";

interface Choice {
  key: string;
  target: SendTarget;
  name: string;
}

/**
 * 게시물 보내기(기능 명세 §8.13). 최근 대화를 먼저 보여 주고, 검색하면 사람을 찾는다. 고른 대화마다
 * 게시물 링크 하나만 보낸다. 받는 쪽은 그 링크를 게시물 카드로 그린다(§13.21).
 */
export function SharePostDialog({
  open,
  onOpenChange,
  path,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 게시물 상세의 앱 내부 경로. 절대 URL은 보내는 순간에 만든다 — render 중에 `window`를 읽지 않는다. */
  path: string;
  title: string;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selected, setSelected] = useState<Choice[]>([]);
  const [sending, setSending] = useState(false);
  // 시트가 열려 있는 동안 대화별 메시지 ID를 기억해, 다시 보내기가 같은 링크를 두 번 저장하지 않게 한다.
  const messageIds = useRef(new Map<string, string>());

  const conversations = useQuery({ ...conversationListQuery(), enabled: open });
  const people = useQuery({
    queryKey: messagingKeys.recipients(searchTerm),
    queryFn: () => searchMessageRecipients(searchTerm),
    enabled: open && searchTerm !== "",
    staleTime: 30_000,
  });

  function reset() {
    messageIds.current = new Map();
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

  const url = () => new URL(path, window.location.origin).toString();

  async function send() {
    if (selected.length === 0 || sending) return;
    setSending(true);
    try {
      const { sent, failed } = await sendToConversations(
        selected.map(({ target }) => target),
        url(),
        messageIds.current,
      );
      void invalidateConversationList(queryClient);
      if (failed === 0) {
        toast.success("게시물을 보냈습니다.");
        close();
      } else if (sent > 0) {
        toast.error(`${failed}곳에 보내지 못했습니다.`);
        close();
      } else {
        // 아무 데도 가지 않았으면 고른 대상을 두고 다시 시도하게 한다.
        toast.error("게시물을 보내지 못했습니다.");
      }
    } finally {
      setSending(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url());
      toast.success("링크를 복사했습니다.");
      close();
    } catch {
      toast.error("링크를 복사하지 못했습니다.");
    }
  }

  async function shareElsewhere() {
    try {
      await navigator.share({ title, url: url() });
      close();
    } catch (error) {
      // 공유 시트를 사용자가 닫은 것은 실패가 아니다.
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("링크를 공유하지 못했습니다.");
    }
  }

  const canShareElsewhere =
    open &&
    typeof navigator.share === "function" &&
    window.matchMedia(NATIVE_SHARE_QUERY).matches;

  // 입력 중에는 최근 대화를 이름으로 걸러 보여 준다. 사람 검색은 Enter로 한다.
  const filter = query.trim().toLowerCase();
  const recent = (conversations.data ?? []).filter(
    (conversation) =>
      canSendToConversation(conversation) &&
      (filter === "" ||
        [conversation.name, conversationProfileName(conversation)].some(
          (name) => name.toLowerCase().includes(filter),
        )),
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
            게시물을 보낼 채팅이나 사람을 고르세요.
          </DialogDescription>
        </DialogHeader>

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
                  name: conversationProfileName(conversation),
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
                    name={conversationProfileName(conversation)}
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
          disabled={selected.length === 0 || sending}
          onClick={() => void send()}
        >
          {sending ? <Spinner data-icon="inline-start" /> : null}
          {selected.length > 1 ? `${selected.length}곳에 보내기` : "보내기"}
        </Button>

        <div className="-mx-6 flex justify-center gap-2 border-t px-6 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void copyLink()}
          >
            <LinkIcon data-icon="inline-start" />
            링크 복사
          </Button>
          {canShareElsewhere ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void shareElsewhere()}
            >
              <ShareIcon data-icon="inline-start" />
              다른 앱으로 공유
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChoiceRow({
  chosen,
  disabled,
  onToggle,
  avatar,
  name,
  description,
}: {
  chosen: boolean;
  disabled: boolean;
  onToggle: () => void;
  avatar: ReactNode;
  name: string;
  description?: string;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={chosen}
        disabled={disabled}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 disabled:hover:bg-transparent",
          chosen && "bg-primary/10 hover:bg-primary/10",
        )}
        onClick={onToggle}
      >
        {avatar}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          {description ? (
            <span className="block truncate text-xs text-muted-foreground">
              {description}
            </span>
          ) : null}
        </span>
        {chosen ? (
          <CheckIcon aria-hidden className="size-4 shrink-0 text-primary" />
        ) : null}
      </button>
    </li>
  );
}

function Centered({
  children,
  className,
  role,
}: {
  children: ReactNode;
  className?: string;
  role?: "alert";
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex justify-center py-8 text-center text-sm text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

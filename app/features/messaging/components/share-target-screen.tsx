import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { ConversationAvatar } from "~/features/messaging/components/conversation-avatar";
import {
  Centered,
  ChoiceRow,
} from "~/features/messaging/components/choice-row";
import {
  conversationListQuery,
  invalidateConversationList,
  messagingKeys,
} from "~/features/messaging/data/cache";
import { openDirectConversation } from "~/features/messaging/data/mutations";
import { searchMessageRecipients } from "~/features/messaging/data/queries";
import {
  appendRoomDraftText,
  roomDraftKey,
} from "~/features/messaging/hooks/room-drafts";
import { canSendToConversation } from "~/features/messaging/model/system-message";
import { UserAvatar } from "~/shared/components/user-avatar";
import { useT } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";

type Destination =
  | { type: "conversation"; conversationId: string }
  | { type: "person"; profileId: string };

/**
 * 다른 앱에서 공유받은 글을 보낼 대화 고르기(기능 명세 §13.24). 하나를 고르면 그 방의 입력창 초안에
 * 글을 넣고 방을 연다. 바로 보내지 않는다 — 공유 시트가 넘긴 글은 앱마다 모양이 달라 보내기 전에
 * 고칠 수 있어야 한다.
 */
export function ShareTargetScreen({
  text,
  viewerId,
}: {
  text: string;
  viewerId: string;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [opening, setOpening] = useState<string | null>(null);

  const conversations = useQuery(conversationListQuery());
  const people = useQuery({
    queryKey: messagingKeys.recipients(searchTerm),
    queryFn: () => searchMessageRecipients(searchTerm),
    enabled: searchTerm !== "",
    staleTime: 30_000,
  });

  async function open(key: string, destination: Destination) {
    if (opening) return;
    setOpening(key);
    try {
      let conversationId: string;
      if (destination.type === "person") {
        conversationId = await openDirectConversation(destination.profileId);
        void invalidateConversationList(queryClient);
      } else {
        conversationId = destination.conversationId;
      }
      appendRoomDraftText(roomDraftKey(viewerId, conversationId), text);
      // 뒤로가기가 이 화면으로 돌아오면 같은 글을 한 번 더 넣게 된다.
      await navigate(`/messenger/${conversationId}`, { replace: true });
    } catch {
      toast.error(t("채팅을 열지 못했습니다."));
      setOpening(null);
    }
  }

  if (text === "") {
    return (
      <Centered className="flex-col items-center gap-3 py-16">
        <p>{t("공유받은 내용이 없습니다.")}</p>
        <Button variant="outline" size="sm" render={<Link to="/messenger" />}>
          {t("메신저로 가기")}
        </Button>
      </Centered>
    );
  }

  const filter = query.trim().toLowerCase();
  const recent = (conversations.data ?? []).filter(
    (conversation) =>
      canSendToConversation(conversation) &&
      (filter === "" || conversation.name.toLowerCase().includes(filter)),
  );

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <section
        aria-label={t("보낼 내용")}
        className="rounded-lg border bg-muted/40 p-3"
      >
        <p className="line-clamp-4 text-sm break-words whitespace-pre-wrap">
          {text}
        </p>
      </section>

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
          placeholder={t("채팅 또는 사람 찾기")}
          aria-label={t("채팅 또는 사람 찾기")}
          className="rounded-full pl-9"
        />
      </form>

      {searchTerm !== "" ? (
        people.isPending ? (
          <Centered>
            <Spinner />
          </Centered>
        ) : people.isError ? (
          <Centered role="alert" className="text-destructive">
            {t("검색 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.")}
          </Centered>
        ) : people.data.length === 0 ? (
          <Centered>{t("일치하는 사람이 없습니다.")}</Centered>
        ) : (
          <ul aria-label={t("찾은 사람")} className="flex flex-col gap-0.5">
            {people.data.map((person) => {
              const key = `person:${person.id}`;
              return (
                <ChoiceRow
                  key={key}
                  chosen={opening === key}
                  action
                  disabled={opening !== null}
                  onToggle={() =>
                    void open(key, { type: "person", profileId: person.id })
                  }
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
      ) : conversations.isError ? (
        <Centered role="alert" className="text-destructive">
          {t("채팅 목록을 불러오지 못했습니다. 이름으로 사람을 찾아보세요.")}
        </Centered>
      ) : recent.length === 0 ? (
        <Centered>
          {filter === ""
            ? t("최근 채팅이 없습니다. 이름으로 사람을 찾아보세요.")
            : t("Enter를 눌러 사람을 찾아보세요.")}
        </Centered>
      ) : (
        <ul aria-label={t("최근 채팅")} className="flex flex-col gap-0.5">
          {recent.map((conversation) => {
            const key = `conversation:${conversation.id}`;
            return (
              <ChoiceRow
                key={key}
                chosen={opening === key}
                action
                disabled={opening !== null}
                onToggle={() =>
                  void open(key, {
                    type: "conversation",
                    conversationId: conversation.id,
                  })
                }
                avatar={
                  <ConversationAvatar
                    conversation={conversation}
                    className="size-10"
                  />
                }
                name={conversation.name}
                description={
                  conversation.type === "group"
                    ? t("그룹 · {count}명", {
                        count: conversation.participants.filter(
                          ({ active }) => active,
                        ).length,
                      })
                    : undefined
                }
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

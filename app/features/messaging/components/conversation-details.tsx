import {
  BellIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  FileIcon,
  ImagesIcon,
  LinkIcon,
  LockKeyholeIcon,
  LogOutIcon,
  PinIcon,
  SearchIcon,
  UserRoundIcon,
  UserPlusIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { ConversationAvatar } from "~/features/messaging/components/conversation-avatar";
import type { Conversation } from "~/features/messaging/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Button } from "~/shared/ui/button";
import { cn } from "~/shared/lib/utils";

export function ConversationDetails({
  conversation,
  className,
  onMobileBack,
  pinnedCount,
  onOpenPinnedMessages,
}: {
  conversation: Conversation;
  className?: string;
  onMobileBack: () => void;
  pinnedCount: number;
  onOpenPinnedMessages: () => void;
}) {
  return (
    <aside
      aria-label="대화 상세"
      className={cn(
        "min-h-0 w-full flex-col border-l bg-background xl:w-80 xl:shrink-0",
        className,
      )}
    >
      <header className="flex h-[calc(var(--app-page-header-h)+var(--app-safe-t))] shrink-0 items-center gap-2 border-b px-3 pt-[var(--app-safe-t)] md:h-16 md:pt-0 xl:hidden">
        <Button
          variant="ghost"
          size="icon"
          className="-ml-1 rounded-full"
          aria-label="대화로 돌아가기"
          onClick={onMobileBack}
        >
          <ChevronLeftIcon aria-hidden />
        </Button>
        <h2 className="text-xl font-semibold">대화 정보</h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(1rem+var(--app-safe-b))]">
        <section className="flex flex-col items-center gap-2 px-3 py-6 text-center">
          <ConversationAvatar conversation={conversation} size="lg" />
          <h2 className="mt-1 max-w-full truncate text-xl font-semibold">
            {conversation.name}
          </h2>
          <div className="mt-3 flex items-start justify-center gap-5">
            {conversation.type === "direct" ? (
              <DetailQuickAction icon={UserRoundIcon} label="프로필" />
            ) : null}
            <DetailQuickAction icon={BellIcon} label="알림" />
            <DetailQuickAction icon={SearchIcon} label="검색" />
            {conversation.type === "group" ? (
              <DetailQuickAction icon={UserPlusIcon} label="초대" />
            ) : null}
          </div>
        </section>

        <div className="flex flex-col gap-1">
          <DetailSection title="대화 정보" defaultOpen>
            <DetailRow
              icon={PinIcon}
              label="고정된 메시지"
              value={String(pinnedCount)}
              onClick={onOpenPinnedMessages}
            />
            <DetailRow icon={LockKeyholeIcon} label="메시지 암호화 안내" />
          </DetailSection>

          {conversation.type === "group" ? (
            <DetailSection
              title={`대화 멤버 ${conversation.participants.length}명`}
            >
              <div className="flex flex-col gap-1 px-2 pb-2">
                {conversation.participants.map((participant) => (
                  <div
                    key={participant.id}
                    className="flex items-center gap-3 rounded-lg px-2 py-2"
                  >
                    <UserAvatar
                      src={participant.avatarUrl}
                      name={participant.name}
                      size="lg"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {participant.id === "viewer"
                        ? `${participant.name} (나)`
                        : participant.name}
                    </span>
                  </div>
                ))}
              </div>
            </DetailSection>
          ) : null}

          <DetailSection title="미디어, 파일 및 링크" defaultOpen>
            <DetailRow
              icon={ImagesIcon}
              label="미디어"
              value={String(conversation.sharedMediaCount)}
            />
            <DetailRow
              icon={FileIcon}
              label="파일"
              value={String(conversation.sharedFileCount)}
            />
            <DetailRow
              icon={LinkIcon}
              label="링크"
              value={String(conversation.sharedLinkCount)}
            />
          </DetailSection>

          <DetailSection title="개인정보 보호 및 지원">
            <DetailRow icon={LockKeyholeIcon} label="개인정보 및 안전" />
            {conversation.type === "group" ? (
              <DetailRow icon={LogOutIcon} label="그룹 나가기" destructive />
            ) : null}
          </DetailSection>
        </div>
      </div>
    </aside>
  );
}

function DetailQuickAction({
  icon: Icon,
  label,
}: {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <div className="flex min-w-12 flex-col items-center gap-1.5">
      <Button
        variant="secondary"
        size="icon"
        className="rounded-full"
        disabled
        aria-label={`${label} 기능 준비 중`}
      >
        <Icon aria-hidden />
      </Button>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function DetailSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-xl" open={defaultOpen || undefined}>
      <summary className="flex cursor-pointer list-none items-center rounded-lg px-3 py-3 text-sm font-semibold outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <ChevronDownIcon
          aria-hidden
          className="size-4 shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      {children}
    </details>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  destructive = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  destructive?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left text-sm disabled:opacity-100",
        destructive && "text-destructive",
      )}
    >
      <Icon aria-hidden className="size-5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value ? (
        <span className="text-xs text-muted-foreground">{value}</span>
      ) : null}
    </button>
  );
}

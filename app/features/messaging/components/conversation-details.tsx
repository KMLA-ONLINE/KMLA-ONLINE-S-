import {
  BellIcon,
  BellOffIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  FileIcon,
  ImagesIcon,
  LockIcon,
  LogOutIcon,
  Trash2Icon,
  PencilIcon,
  PinIcon,
  SearchIcon,
  UserRoundIcon,
  UserPlusIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { ConversationAvatar } from "~/features/messaging/components/conversation-avatar";
import {
  activeParticipants,
  isViewerActive,
} from "~/features/messaging/model/system-message";
import type {
  Conversation,
  MessageParticipant,
} from "~/features/messaging/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Button } from "~/shared/ui/button";
import { cn } from "~/shared/lib/utils";

export function ConversationDetails({
  conversation,
  className,
  onMobileBack,
  pinnedCount,
  onOpenPinnedMessages,
  muted,
  onToggleMuted,
  onSearch,
  onInvite,
  onRename,
  onLeave,
  onDeleteGroup,
  sharedCounts,
  onOpenSharedMedia,
}: {
  conversation: Conversation;
  className?: string;
  onMobileBack: () => void;
  pinnedCount: number;
  onOpenPinnedMessages: () => void;
  muted: boolean;
  onToggleMuted: () => void;
  onSearch: () => void;
  onInvite: () => void;
  onRename: () => void;
  onLeave: () => void;
  /** 소유주에게만 보인다. */
  onDeleteGroup: () => void;
  /** 공유된 사진과 파일 수. 아직 모르면 비어 있다. */
  sharedCounts: { media: number; files: number } | undefined;
  onOpenSharedMedia: (tab: "media" | "files") => void;
}) {
  const members = activeParticipants(conversation);
  // 나갔거나 내보내진 그룹에서는 지난 메시지만 보이고 멤버 관리는 할 수 없다.
  const manageable =
    conversation.type === "group" && isViewerActive(conversation);
  const counterpart =
    conversation.type === "direct"
      ? conversation.participants.find(({ id }) => id !== conversation.viewerId)
      : undefined;
  return (
    <aside
      aria-label="채팅 상세"
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
          aria-label="채팅으로 돌아가기"
          onClick={onMobileBack}
        >
          <ChevronLeftIcon aria-hidden />
        </Button>
        <h2 className="text-xl font-semibold">채팅 정보</h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 pb-[calc(1rem+var(--app-safe-b))]">
        <section className="flex flex-col items-center gap-2 px-3 py-6 text-center">
          <ConversationAvatar conversation={conversation} size="lg" />
          <h2 className="mt-1 max-w-full truncate text-xl font-semibold">
            {conversation.name}
          </h2>
          <div className="mt-3 flex items-start justify-center gap-5">
            {conversation.type === "group" ? (
              <DetailQuickAction
                icon={UserPlusIcon}
                label="초대"
                actionLabel="멤버 초대"
                onClick={manageable ? onInvite : undefined}
              />
            ) : null}
            {conversation.type === "direct" ? (
              <DetailQuickAction
                icon={UserRoundIcon}
                label="프로필"
                actionLabel={`${conversation.name} 프로필`}
                href={
                  counterpart?.pubId
                    ? `/profile/${counterpart.pubId}`
                    : undefined
                }
              />
            ) : null}
            <DetailQuickAction
              icon={muted ? BellOffIcon : BellIcon}
              label={muted ? "알림 꺼짐" : "알림"}
              actionLabel={muted ? "채팅 알림 켜기" : "채팅 알림 끄기"}
              pressed={muted}
              onClick={onToggleMuted}
            />
            <DetailQuickAction
              icon={SearchIcon}
              label="검색"
              actionLabel="채팅에서 찾기"
              onClick={onSearch}
            />
          </div>
        </section>

        <div className="flex flex-col gap-1">
          {/* 패널 제목이 이미 `채팅 정보`라 이 묶음에는 제목을 달지 않는다. */}
          <DetailRow
            icon={PinIcon}
            label="고정된 메시지"
            value={String(pinnedCount)}
            onClick={onOpenPinnedMessages}
          />
          {manageable ? (
            <DetailRow
              icon={PencilIcon}
              label="그룹 이름 변경"
              onClick={onRename}
            />
          ) : null}

          {conversation.type === "group" ? (
            <DetailSection title={`채팅 멤버 ${members.length}명`}>
              <div className="flex flex-col gap-1 px-2 pb-2">
                {members.map((participant) => (
                  <div
                    key={participant.id}
                    className="flex items-center gap-1 rounded-lg"
                  >
                    <MemberProfileLink participant={participant}>
                      <UserAvatar
                        src={participant.avatarUrl}
                        name={participant.name}
                        size="lg"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {participant.id === conversation.viewerId
                          ? `${participant.name} (나)`
                          : participant.name}
                      </span>
                    </MemberProfileLink>
                  </div>
                ))}
              </div>
            </DetailSection>
          ) : null}

          <DetailSection title="공유된 미디어" defaultOpen>
            <DetailRow
              icon={ImagesIcon}
              label="사진"
              value={sharedCounts ? String(sharedCounts.media) : undefined}
              onClick={() => onOpenSharedMedia("media")}
            />
            <DetailRow
              icon={FileIcon}
              label="파일"
              value={sharedCounts ? String(sharedCounts.files) : undefined}
              onClick={() => onOpenSharedMedia("files")}
            />
          </DetailSection>

          {/* 되돌릴 수 없는 작업은 선으로 떼어 따로 묶는다. */}
          {manageable ? (
            <div className="mt-2 flex flex-col gap-1 border-t pt-3">
              <DetailRow
                icon={LogOutIcon}
                label="그룹 나가기"
                destructive
                onClick={onLeave}
              />
              {conversation.canDelete ? (
                <DetailRow
                  icon={Trash2Icon}
                  label="채팅방 삭제"
                  destructive
                  onClick={onDeleteGroup}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        <p className="flex items-center justify-center gap-1.5 px-3 pt-6 text-xs text-muted-foreground">
          <LockIcon aria-hidden className="size-3.5 shrink-0" />
          메시지는 암호화되어 저장됩니다.
        </p>
      </div>
    </aside>
  );
}

/** 그룹 멤버 한 줄. 프로필 주소를 알면 그 사람의 프로필로 간다. */
function MemberProfileLink({
  participant,
  children,
}: {
  participant: MessageParticipant;
  children: ReactNode;
}) {
  const className =
    "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2";
  if (!participant.pubId) return <div className={className}>{children}</div>;
  return (
    <Link
      to={`/profile/${participant.pubId}`}
      aria-label={`${participant.name} 프로필`}
      className={cn(
        className,
        "hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
      )}
    >
      {children}
    </Link>
  );
}

/** `onClick`과 `href`가 모두 없으면 아직 준비 중인 기능으로 비활성화한다. */
function DetailQuickAction({
  icon: Icon,
  label,
  actionLabel,
  pressed,
  onClick,
  href,
}: {
  icon: LucideIcon;
  label: string;
  actionLabel?: string;
  pressed?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const enabled = Boolean(onClick ?? href);
  return (
    <div className="flex min-w-12 flex-col items-center gap-1.5">
      <Button
        variant="secondary"
        size="icon"
        className="rounded-full"
        disabled={!enabled}
        aria-label={enabled ? (actionLabel ?? label) : `${label} 기능 준비 중`}
        aria-pressed={pressed}
        onClick={onClick}
        {...(href ? { nativeButton: false, render: <Link to={href} /> } : {})}
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
      <summary className="flex cursor-pointer list-none items-center rounded-lg px-3 py-3 text-sm font-semibold outline-none select-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
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
        "flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left text-sm hover:bg-muted/70 disabled:opacity-100",
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

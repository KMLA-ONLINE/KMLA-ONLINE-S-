import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { DownloadIcon, FileIcon, PlayIcon, XIcon } from "lucide-react";
import { useState } from "react";

import {
  createAttachmentUrls,
  toDownloadUrl,
} from "~/features/messaging/data/files";
import {
  listSharedAttachments,
  type SharedAttachment,
} from "~/features/messaging/data/queries";
import { messagingKeys } from "~/features/messaging/data/cache";
import { formatFileSize } from "~/features/messaging/model/attachments";
import { formatMessageDay } from "~/features/messaging/model/message-time";
import type { MessageCursor } from "~/features/messaging/model/types";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Spinner } from "~/shared/ui/spinner";

/**
 * 공유된 미디어와 파일(기능 명세 §13.18). 사진·동영상은 격자, 파일은 유형·이름·크기로 보이고 더
 * 불러올 수 있다. 신규 멤버에게는 서버가 참여 이후의 첨부만 준다. 항목을 고르면 원래 메시지로 간다.
 */
export function SharedMediaDialog({
  conversationId,
  initialTab,
  counts,
  onClose,
  onViewMessage,
}: {
  conversationId: string;
  initialTab: "media" | "files";
  counts: { media: number; files: number } | undefined;
  onClose: () => void;
  onViewMessage: (messageId: string) => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const media = tab === "media";
  const pages = useInfiniteQuery({
    queryKey: messagingKeys.sharedAttachments(conversationId, media),
    queryFn: ({ pageParam }) =>
      listSharedAttachments(conversationId, media, pageParam),
    initialPageParam: null as MessageCursor | null,
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 0,
  });
  const items = pages.data?.pages.flatMap((page) => page.items) ?? [];
  const paths = items
    .map((item) => item.thumbnailPath ?? item.objectPath)
    .concat(
      items
        .filter(({ kind }) => kind !== "image")
        .map((item) => item.objectPath),
    );
  const urls = useQuery({
    queryKey: messagingKeys.attachmentUrls(paths),
    queryFn: () => createAttachmentUrls(paths),
    enabled: paths.length > 0,
    staleTime: 55 * 60_000,
  }).data;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* 휴대폰에서는 화면 전체를 덮고, 뒤로가기로 닫는다(URL의 `?panel=`). */}
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(40rem,90dvh)] flex-col max-sm:top-0 max-sm:left-0 max-sm:h-svh max-sm:max-h-svh max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:gap-4 max-sm:rounded-none max-sm:px-4 max-sm:pt-[calc(1rem+var(--app-safe-t))] max-sm:pb-[calc(1rem+var(--app-safe-b))] max-sm:ring-0 sm:max-w-lg"
      >
        <DialogHeader className="flex-row items-center justify-between gap-2">
          <DialogTitle>공유된 미디어</DialogTitle>
          <DialogDescription className="sr-only">
            이 대화에서 주고받은 사진과 파일
          </DialogDescription>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="닫기"
            className="-my-1 shrink-0 rounded-full text-muted-foreground"
            onClick={onClose}
          >
            <XIcon aria-hidden />
          </Button>
        </DialogHeader>
        <div role="tablist" aria-label="첨부 종류" className="flex gap-1">
          {(
            [
              ["media", "사진·동영상", counts?.media],
              ["files", "파일", counts?.files],
            ] as const
          ).map(([value, label, count]) => (
            <Button
              key={value}
              role="tab"
              aria-selected={tab === value}
              variant={tab === value ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTab(value)}
            >
              {label}
              {count === undefined ? null : ` ${count}`}
            </Button>
          ))}
        </div>
        <div className="min-h-32 flex-1 overflow-y-auto overscroll-contain">
          {pages.isPending ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : pages.isError ? (
            <p
              role="alert"
              className="py-8 text-center text-sm text-destructive"
            >
              불러오지 못했습니다.
            </p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {media
                ? "주고받은 사진과 동영상이 없습니다."
                : "주고받은 파일이 없습니다."}
            </p>
          ) : media ? (
            <ul aria-label="사진·동영상" className="grid grid-cols-3 gap-0.5">
              {items.map((item) => (
                <li key={item.id}>
                  <MediaTile
                    item={item}
                    url={urls?.get(item.thumbnailPath ?? item.objectPath)}
                    onSelect={() => onViewMessage(item.messageId)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <ul aria-label="파일" className="flex flex-col gap-1">
              {items.map((item) => (
                <li key={item.id}>
                  <FileRow item={item} url={urls?.get(item.objectPath)} />
                </li>
              ))}
            </ul>
          )}
          {pages.hasNextPage ? (
            <div className="flex justify-center py-3">
              <Button
                variant="outline"
                size="sm"
                disabled={pages.isFetchingNextPage}
                onClick={() => void pages.fetchNextPage()}
              >
                {pages.isFetchingNextPage ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                더 불러오기
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MediaTile({
  item,
  url,
  onSelect,
}: {
  item: SharedAttachment;
  url: string | undefined;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${formatMessageDay(item.sentAt)} ${item.kind === "image" ? "사진" : "동영상"}, 원래 메시지로 이동`}
      className="relative block aspect-square w-full overflow-hidden bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={onSelect}
    >
      {item.kind === "image" && url ? (
        <img
          src={url}
          alt=""
          crossOrigin="anonymous"
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      ) : null}
      {item.kind === "video" ? (
        <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <PlayIcon aria-hidden className="size-7" />
        </span>
      ) : null}
    </button>
  );
}

function FileRow({
  item,
  url,
}: {
  item: SharedAttachment;
  url: string | undefined;
}) {
  const extension = item.fileName.includes(".")
    ? item.fileName.split(".").pop()?.toUpperCase()
    : undefined;
  return (
    <a
      href={url ? toDownloadUrl(url, item.fileName) : undefined}
      aria-label={`내려받기: ${item.fileName}`}
      aria-disabled={!url}
      className={cn(
        "flex items-center gap-3 rounded-lg px-2 py-2",
        url && "hover:bg-muted/70",
      )}
    >
      <FileIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{item.fileName}</span>
        <span className="block text-xs text-muted-foreground">
          {[
            extension,
            formatFileSize(item.sizeBytes),
            formatMessageDay(item.sentAt),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <DownloadIcon
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
      />
    </a>
  );
}

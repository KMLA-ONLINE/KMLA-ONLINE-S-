import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { FileIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

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
import {
  DownloadNote,
  DownloadStatus,
} from "~/shared/components/download-status";
import type { ViewerImage } from "~/shared/components/image-viewer";
import { useImageViewerParam } from "~/shared/hooks/use-image-viewer-param";
import {
  managedDownloadLabel,
  useManagedDownload,
} from "~/shared/hooks/use-managed-download";
import { previewDocumentOnClick } from "~/shared/lib/document-preview";
import { cn } from "~/shared/lib/utils";
import { useLocale, useT } from "~/shared/i18n";
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
 * 공유된 미디어와 파일(기능 명세 §13.18). 사진은 격자, 파일은 유형·이름·크기로 보이고 더
 * 불러올 수 있다. 신규 멤버에게는 서버가 참여 이후의 첨부만 준다. 사진을 고르면 그 자리에서 뷰어로
 * 열고 불러온 사진끼리 넘겨 본다.
 */
export function SharedMediaDialog({
  conversationId,
  initialTab,
  counts,
  onClose,
}: {
  conversationId: string;
  initialTab: "media" | "files";
  counts: { media: number; files: number } | undefined;
  onClose: () => void;
}) {
  const t = useT();
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
  const items = useMemo(
    () => pages.data?.pages.flatMap((page) => page.items) ?? [],
    [pages.data],
  );
  // 사진은 뷰어가 원본을 열 수 있게 원본 경로도 서명한다. 서명만 하고 받는 것은 뷰어를 열 때다.
  const paths = items
    .map((item) => item.thumbnailPath ?? item.objectPath)
    .concat(items.map((item) => item.objectPath));
  const urls = useQuery({
    queryKey: messagingKeys.attachmentUrls(paths),
    queryFn: () => createAttachmentUrls(paths),
    enabled: paths.length > 0,
    staleTime: 55 * 60_000,
  }).data;
  const images = useMemo<ViewerImage[]>(
    () =>
      (media ? items : []).flatMap((item) => {
        const src = urls?.get(item.objectPath);
        if (!src) return [];
        return [
          {
            id: item.id,
            src,
            thumbSrc: item.thumbnailPath
              ? urls?.get(item.thumbnailPath)
              : undefined,
            downloadSrc: toDownloadUrl(src, item.fileName),
            name: item.fileName,
            width: item.width ?? undefined,
            height: item.height ?? undefined,
          },
        ];
      }),
    [items, media, urls],
  );
  const viewer = useImageViewerParam(images);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* 휴대폰에서는 화면 전체를 덮고, 뒤로가기로 닫는다(URL의 `?panel=`). */}
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(40rem,90dvh)] flex-col max-sm:top-0 max-sm:left-0 max-sm:h-svh max-sm:max-h-svh max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:gap-4 max-sm:rounded-none max-sm:px-4 max-sm:pt-[calc(1rem+var(--app-safe-t))] max-sm:pb-[calc(1rem+var(--app-safe-b))] max-sm:ring-0 sm:max-w-lg"
      >
        <DialogHeader className="flex-row items-center justify-between gap-2">
          <DialogTitle>{t("공유된 미디어")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("이 채팅에서 주고받은 사진과 파일")}
          </DialogDescription>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("닫기")}
            className="-my-1 shrink-0 rounded-full text-muted-foreground"
            onClick={onClose}
          >
            <XIcon aria-hidden />
          </Button>
        </DialogHeader>
        <div role="tablist" aria-label={t("첨부 종류")} className="flex gap-1">
          {(
            [
              ["media", t("사진"), counts?.media],
              ["files", t("파일"), counts?.files],
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
        <div className="min-h-32 flex-1 overflow-y-auto overscroll-x-desktop-auto overscroll-y-contain">
          {pages.isPending ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : pages.isError ? (
            <p
              role="alert"
              className="py-8 text-center text-sm text-destructive"
            >
              {t("불러오지 못했습니다.")}
            </p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {media
                ? t("주고받은 사진이 없습니다.")
                : t("주고받은 파일이 없습니다.")}
            </p>
          ) : media ? (
            <ul aria-label={t("사진")} className="grid grid-cols-3 gap-0.5">
              {items.map((item) => (
                <li key={item.id}>
                  <MediaTile
                    item={item}
                    url={urls?.get(item.thumbnailPath ?? item.objectPath)}
                    onSelect={() => viewer.open(item.id)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <ul aria-label={t("파일")} className="flex flex-col gap-1">
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
                {t("더 불러오기")}
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
  const t = useT();
  const locale = useLocale();
  return (
    <button
      type="button"
      aria-label={t("{day} 사진 크게 보기", {
        day: formatMessageDay(item.sentAt, undefined, locale),
      })}
      className="relative block aspect-square w-full overflow-hidden bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={onSelect}
    >
      {url ? (
        <img
          src={url}
          alt=""
          crossOrigin="anonymous"
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
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
  const t = useT();
  const locale = useLocale();
  const download = useManagedDownload();
  const status = managedDownloadLabel(download.state);
  const extension = item.fileName.includes(".")
    ? item.fileName.split(".").pop()?.toUpperCase()
    : undefined;
  return (
    <a
      href={url ? toDownloadUrl(url, item.fileName) : undefined}
      onClick={(event) => {
        if (!url) return;
        const previewed = previewDocumentOnClick(event, {
          url,
          downloadUrl: event.currentTarget.href,
          fileName: item.fileName,
        });
        if (previewed) return;
        download.handleClick(event, [{ url, fileName: item.fileName }]);
      }}
      aria-label={`${status ?? t("내려받기")}: ${item.fileName}`}
      aria-busy={download.state.status === "loading" || undefined}
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
            formatMessageDay(item.sentAt, undefined, locale),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <DownloadNote state={download.state} />
      </span>
      <DownloadStatus state={download.state} />
    </a>
  );
}

import { useQuery } from "@tanstack/react-query";
import { DownloadIcon, FileIcon, MusicIcon, PlayIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  createAttachmentUrls,
  loadPlayableAttachment,
  toDownloadUrl,
} from "~/features/messaging/data/files";
import { messagingKeys } from "~/features/messaging/data/cache";
import {
  formatFileSize,
  isMediaKind,
} from "~/features/messaging/model/attachments";
import type { MessageAttachment } from "~/features/messaging/model/types";
import type { ViewerImage } from "~/shared/components/image-viewer";
import { useImageViewerParam } from "~/shared/hooks/use-image-viewer-param";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Spinner } from "~/shared/ui/spinner";

/** 첨부 object의 signed URL. 서버에 올라가지 않은(보내는 중인) 첨부는 건너뛴다. */
function useAttachmentUrls(attachments: MessageAttachment[]) {
  const paths = attachments
    .flatMap((attachment) => [attachment.objectPath, attachment.thumbnailPath])
    .filter((path): path is string => Boolean(path));
  return useQuery({
    queryKey: messagingKeys.attachmentUrls(paths),
    queryFn: () => createAttachmentUrls(paths),
    enabled: paths.length > 0,
    staleTime: 55 * 60_000,
    gcTime: 55 * 60_000,
  }).data;
}

/**
 * 메시지 첨부(기능 명세 §13.6). 사진과 동영상은 격자로, 오디오는 그 자리에서 재생하고, 그 밖의
 * 파일은 이름과 크기를 보이고 내려받기로만 연다. 재생은 내려받은 뒤 실제 형식을 확인한 경우에만 한다.
 */
export function MessageAttachments({
  attachments,
  isOwn,
  pending = false,
}: {
  attachments: MessageAttachment[];
  isOwn: boolean;
  pending?: boolean;
}) {
  const urls = useAttachmentUrls(attachments);
  const media = attachments.filter(({ kind }) => isMediaKind(kind));
  const others = attachments.filter(({ kind }) => !isMediaKind(kind));

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-1",
        isOwn ? "items-end" : "items-start",
        pending && "opacity-60",
      )}
      aria-busy={pending}
    >
      {media.length > 0 ? (
        <MediaGrid media={media} urls={urls} pending={pending} />
      ) : null}
      {others.map((attachment) =>
        attachment.kind === "audio" ? (
          <AudioAttachment
            key={attachment.id}
            attachment={attachment}
            pending={pending}
          />
        ) : (
          <FileAttachment
            key={attachment.id}
            attachment={attachment}
            url={urls?.get(attachment.objectPath)}
          />
        ),
      )}
    </div>
  );
}

function MediaGrid({
  media,
  urls,
  pending,
}: {
  media: MessageAttachment[];
  urls: Map<string, string> | undefined;
  pending: boolean;
}) {
  const [playing, setPlaying] = useState<MessageAttachment | null>(null);
  const images = useMemo<ViewerImage[]>(
    () =>
      media
        .filter(({ kind }) => kind === "image")
        .map((attachment) => {
          const src =
            urls?.get(attachment.objectPath) ?? attachment.previewUrl ?? "";
          return {
            id: attachment.id,
            src,
            thumbSrc: attachment.thumbnailPath
              ? urls?.get(attachment.thumbnailPath)
              : undefined,
            downloadSrc: src ? toDownloadUrl(src, attachment.fileName) : "",
            name: attachment.fileName,
            width: attachment.width ?? undefined,
            height: attachment.height ?? undefined,
          };
        })
        .filter(({ src }) => src !== ""),
    [media, urls],
  );
  const viewer = useImageViewerParam(images, { downloadAll: true });
  const single = media.length === 1;

  return (
    <>
      <div
        className={cn(
          "grid max-w-72 gap-0.5 overflow-hidden rounded-2xl",
          single
            ? "grid-cols-1"
            : media.length === 2 || media.length === 4
              ? "grid-cols-2"
              : "grid-cols-3",
        )}
      >
        {media.map((attachment) => {
          const thumb =
            attachment.previewUrl ??
            (attachment.thumbnailPath
              ? urls?.get(attachment.thumbnailPath)
              : undefined) ??
            (attachment.kind === "image"
              ? urls?.get(attachment.objectPath)
              : undefined);
          const ratio =
            single && attachment.width && attachment.height
              ? `${attachment.width} / ${attachment.height}`
              : "1 / 1";
          return (
            <button
              key={attachment.id}
              type="button"
              disabled={pending}
              aria-label={
                attachment.kind === "image"
                  ? `사진 크게 보기: ${attachment.fileName}`
                  : `동영상 재생: ${attachment.fileName}`
              }
              className="relative block min-w-0 overflow-hidden bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              style={{ aspectRatio: ratio }}
              onClick={() =>
                attachment.kind === "image"
                  ? viewer.open(attachment.id)
                  : setPlaying(attachment)
              }
            >
              {attachment.kind === "image" && thumb ? (
                <img
                  src={thumb}
                  alt=""
                  crossOrigin="anonymous"
                  className="size-full object-cover"
                />
              ) : attachment.kind === "video" && attachment.previewUrl ? (
                <video
                  src={attachment.previewUrl}
                  muted
                  playsInline
                  className="size-full object-cover"
                />
              ) : null}
              {attachment.kind === "video" ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
                  <PlayIcon aria-hidden className="size-8 fill-current" />
                </span>
              ) : null}
              {pending ? (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Spinner />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {playing ? (
        <VideoPlayerDialog
          attachment={playing}
          onClose={() => setPlaying(null)}
        />
      ) : null}
    </>
  );
}

/** 내려받아 형식을 확인한 Blob URL. 다 쓰면 거둔다. */
function usePlayableUrl(attachment: MessageAttachment, enabled: boolean) {
  const [state, setState] = useState<
    | { status: "idle" | "loading" | "unsupported" | "failed" }
    | { status: "ready"; url: string }
  >({ status: "idle" });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let created: string | null = null;
    loadPlayableAttachment(attachment).then(
      (url) => {
        created = url;
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        setState(url ? { status: "ready", url } : { status: "unsupported" });
      },
      () => {
        if (!cancelled) setState({ status: "failed" });
      },
    );
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [attachment, enabled]);

  // 불러오기를 켠 뒤 결과가 오기 전까지는 불러오는 중이다.
  return enabled && state.status === "idle"
    ? ({ status: "loading" } as const)
    : state;
}

function VideoPlayerDialog({
  attachment,
  onClose,
}: {
  attachment: MessageAttachment;
  onClose: () => void;
}) {
  const state = usePlayableUrl(attachment, true);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl bg-black p-2 text-white">
        <DialogTitle className="sr-only">{attachment.fileName}</DialogTitle>
        <DialogDescription className="sr-only">동영상 재생</DialogDescription>
        {state.status === "ready" ? (
          <video
            src={state.url}
            controls
            autoPlay
            playsInline
            className="max-h-[80dvh] w-full"
          >
            {/* 사용자가 보낸 동영상이라 자막 파일이 없다. */}
            <track kind="captions" />
          </video>
        ) : state.status === "loading" || state.status === "idle" ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <p className="p-6 text-center text-sm">
            {state.status === "unsupported"
              ? "이 동영상은 앱에서 재생할 수 없습니다. 내려받아 열어 주세요."
              : "동영상을 불러오지 못했습니다."}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AudioAttachment({
  attachment,
  pending,
}: {
  attachment: MessageAttachment;
  pending: boolean;
}) {
  const [requested, setRequested] = useState(false);
  const state = usePlayableUrl(attachment, requested && !pending);

  if (state.status === "ready") {
    return (
      <audio
        src={state.url}
        controls
        autoPlay
        aria-label={attachment.fileName}
        className="w-64 max-w-full"
      >
        {/* 사용자가 보낸 오디오라 자막 파일이 없다. */}
        <track kind="captions" />
      </audio>
    );
  }

  return (
    <div className="flex w-64 max-w-full items-center gap-2 rounded-2xl bg-muted px-3 py-2">
      <MusicIcon
        aria-hidden
        className="size-5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{attachment.fileName}</span>
        <span className="block text-xs text-muted-foreground">
          {state.status === "unsupported"
            ? "재생할 수 없는 형식입니다"
            : state.status === "failed"
              ? "불러오지 못했습니다"
              : formatFileSize(attachment.sizeBytes)}
        </span>
      </span>
      {state.status === "loading" ? (
        <Spinner />
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          aria-label={`재생: ${attachment.fileName}`}
          disabled={pending || state.status === "unsupported"}
          onClick={() => setRequested(true)}
        >
          <PlayIcon aria-hidden />
        </Button>
      )}
    </div>
  );
}

function FileAttachment({
  attachment,
  url,
}: {
  attachment: MessageAttachment;
  url: string | undefined;
}) {
  const content = (
    <>
      <FileIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{attachment.fileName}</span>
        <span className="block text-xs text-muted-foreground">
          {formatFileSize(attachment.sizeBytes)}
        </span>
      </span>
      <DownloadIcon
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
      />
    </>
  );
  const className =
    "flex w-64 max-w-full items-center gap-2 rounded-2xl bg-muted px-3 py-2 text-left";

  return url ? (
    <a
      href={toDownloadUrl(url, attachment.fileName)}
      aria-label={`내려받기: ${attachment.fileName}`}
      className={cn(className, "hover:bg-muted/70")}
    >
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

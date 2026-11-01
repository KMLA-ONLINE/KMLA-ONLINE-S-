import {
  attachmentKindLabel,
  attachmentMotionKind,
  isVisualAttachmentKind,
} from "~/features/messaging/model/attachments";
import { useQuery } from "@tanstack/react-query";
import {
  FileIcon,
  ImageOffIcon,
  MusicIcon,
  PauseIcon,
  PlayIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createAttachmentUrls,
  loadPlayableAttachment,
  toDownloadUrl,
} from "~/features/messaging/data/files";
import { messagingKeys } from "~/features/messaging/data/cache";
import {
  groupCornerClass,
  type GroupJoin,
} from "~/features/messaging/components/group-corners";
import { formatFileSize } from "~/features/messaging/model/attachments";
import type { MessageAttachment } from "~/features/messaging/model/types";
import {
  DownloadNote,
  DownloadStatus,
} from "~/shared/components/download-status";
import type { ViewerImage } from "~/shared/components/image-viewer";
import { MotionTile } from "~/shared/components/motion-tile";
import { useImageViewerParam } from "~/shared/hooks/use-image-viewer-param";
import {
  managedDownloadLabel,
  useManagedDownload,
} from "~/shared/hooks/use-managed-download";
import { previewDocumentOnClick } from "~/shared/lib/document-preview";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";

/** 말풍선 격자에 까는 최대 칸 수. */
const MEDIA_GRID_LIMIT = 6;

/**
 * 첨부 object의 signed URL query. 서버에 올라가지 않은(보내는 중인) 첨부는 건너뛴다. 사진 칸은
 * `isError`를 보고 끝없이 도는 대신 깨진 사진을 그린다.
 */
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
  });
}

/**
 * 메시지 첨부(기능 명세 §13.6). 사진은 격자로, 오디오는 그 자리에서 재생하고, 그 밖의
 * 파일은 이름과 크기를 보이고 내려받기로만 연다. 재생은 내려받은 뒤 실제 형식을 확인한 경우에만 한다.
 */
export function MessageAttachments({
  attachments,
  isOwn,
  pending = false,
  join = { above: false, below: false },
}: {
  attachments: MessageAttachment[];
  isOwn: boolean;
  pending?: boolean;
  /** 첨부 묶음 전체가 위·아래 조각과 맞닿는지. 첨부끼리는 늘 맞닿는다. */
  join?: GroupJoin;
}) {
  const { data: urls, isError: urlsFailed } = useAttachmentUrls(attachments);
  const media = attachments.filter(({ kind }) => isVisualAttachmentKind(kind));
  const others = attachments.filter(
    ({ kind }) => !isVisualAttachmentKind(kind),
  );
  // 사진 격자가 첫 조각이고, 그 밖의 첨부가 하나씩 뒤따른다.
  const pieceCount = (media.length > 0 ? 1 : 0) + others.length;
  const cornerOf = (piece: number) =>
    groupCornerClass(isOwn, {
      above: piece > 0 || join.above,
      below: piece < pieceCount - 1 || join.below,
    });
  const firstOther = media.length > 0 ? 1 : 0;

  return (
    <div
      className={cn(
        // 묶음 안 메시지 사이와 같은 간격으로 조각을 띄운다.
        "flex w-full min-w-0 flex-col gap-0.5",
        isOwn ? "items-end" : "items-start",
        pending && "opacity-60",
      )}
      aria-busy={pending}
    >
      {media.length > 0 ? (
        <MediaGrid
          media={media}
          urls={urls}
          urlsFailed={urlsFailed}
          pending={pending}
          cornerClassName={cornerOf(0)}
        />
      ) : null}
      {others.map((attachment, index) =>
        attachment.kind === "audio" ? (
          <AudioAttachment
            key={attachment.id}
            attachment={attachment}
            pending={pending}
            cornerClassName={cornerOf(firstOther + index)}
          />
        ) : (
          <FileAttachment
            key={attachment.id}
            attachment={attachment}
            url={urls?.get(attachment.objectPath)}
            pending={pending}
            cornerClassName={cornerOf(firstOther + index)}
          />
        ),
      )}
    </div>
  );
}

function MediaGrid({
  media,
  urls,
  urlsFailed,
  pending,
  cornerClassName,
}: {
  media: MessageAttachment[];
  urls: Map<string, string> | undefined;
  urlsFailed: boolean;
  pending: boolean;
  cornerClassName: string;
}) {
  const images = useMemo<ViewerImage[]>(
    () =>
      media
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
            motion: attachmentMotionKind(attachment.kind),
          };
        })
        .filter(({ src }) => src !== ""),
    [media, urls],
  );
  const viewer = useImageViewerParam(images, { downloadAll: true });
  const single = media.length === 1;
  // 말풍선에는 여섯 칸까지만 깐다. 나머지는 마지막 칸의 `+N`으로 알리고, 뷰어에서 넘겨 본다.
  const visible = media.slice(0, MEDIA_GRID_LIMIT);
  const hiddenCount = media.length - visible.length;
  // 다섯 장은 3열에 놓으면 오른쪽 아래가 비므로 위 2장, 아래 3장으로 6열을 나눠 깐다.
  const five = visible.length === 5;
  const [first] = visible;
  // 사진이 오기 전에 자리를 잡도록 격자 폭을 먼저 정한다. 폭이 사진에서 나오면 사진이 뜰 때까지 칸이
  // 0으로 접혀 있다가 갑자기 펴지며 대화를 밀어낸다. 작은 사진 한 장은 원래 크기보다 키우지 않는다.
  const gridWidth =
    single && first?.width ? `min(18rem, ${first.width}px)` : "18rem";

  return (
    <>
      <div
        style={{ width: gridWidth }}
        className={cn(
          "grid max-w-full gap-0.5 overflow-hidden rounded-2xl",
          cornerClassName,
          single
            ? "grid-cols-1"
            : visible.length === 2 || visible.length === 4
              ? "grid-cols-2"
              : five
                ? "grid-cols-6"
                : "grid-cols-3",
        )}
      >
        {visible.map((attachment, index) => {
          const motion = attachmentMotionKind(attachment.kind);
          // 100%가 되면 올리는 단계다.
          const compressing =
            attachment.compressPercent !== undefined &&
            attachment.compressPercent < 100;
          const more =
            hiddenCount > 0 && index === visible.length - 1 ? hiddenCount : 0;
          const thumb =
            attachment.previewUrl ??
            (attachment.thumbnailPath
              ? urls?.get(attachment.thumbnailPath)
              : undefined) ??
            urls?.get(attachment.objectPath);
          const motionSrc = urls?.get(attachment.objectPath);
          const ratio =
            single && attachment.width && attachment.height
              ? `${attachment.width} / ${attachment.height}`
              : "1 / 1";
          // 세로로 아주 긴 사진 한 장이 대화를 덮지 않게 9:16(폭 288px에서 512px)까지만 세우고 나머지는
          // 잘라 그린다. 전체는 뷰어에서 본다. 폭을 정해 두지 않으면 최대 높이에 걸린 비율이 폭까지 줄여
          // 칸 오른쪽이 빈다.
          return (
            <button
              key={attachment.id}
              type="button"
              disabled={pending}
              aria-label={
                more > 0
                  ? `사진 ${more}장 더 보기`
                  : `${attachmentKindLabel(attachment.kind)} 크게 보기: ${attachment.fileName}`
              }
              className={cn(
                "relative block max-h-[32rem] w-full min-w-0 overflow-hidden bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                five && (index < 2 ? "col-span-3" : "col-span-2"),
              )}
              style={{ aspectRatio: ratio }}
              onClick={() => viewer.open(attachment.id)}
            >
              {motion && !pending && motionSrc ? (
                <MotionTile
                  kind={motion}
                  src={motionSrc}
                  poster={
                    attachment.thumbnailPath
                      ? urls?.get(attachment.thumbnailPath)
                      : undefined
                  }
                  alt=""
                />
              ) : thumb ? (
                <GridImage src={thumb} showLoading={!pending} />
              ) : pending ? null : urlsFailed || urls ? (
                // 받은 signed URL에 이 사진이 없으면 지워진 object다. 기다려도 오지 않는다.
                <TileMark failed />
              ) : (
                <TileMark />
              )}
              {more > 0 ? (
                <span
                  aria-hidden
                  className="absolute inset-0 flex items-center justify-center bg-black/45 text-xl font-semibold text-white"
                >
                  +{more}
                </span>
              ) : null}
              {pending ? (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                  <Spinner />
                  {compressing ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      압축 중 {attachment.compressPercent}%
                    </span>
                  ) : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * 격자 칸 하나의 사진. 칸은 비율로 자리를 미리 잡고 있으므로, 사진이 다 올 때까지 그 자리에서 돌다가
 * 사진으로 바꿔 그린다. 방을 열면 한 페이지(50개) 안의 사진을 다 그린다. 화면 밖 사진은 스크롤해
 * 다가갈 때 받는다.
 *
 * 한 번 그린 사진은 주소가 바뀌어도(보낸 뒤 서버 주소로, signed URL 갱신) 가리지 않는다. 가리면 방의
 * 사진이 모두 스피너로 깜빡인다. 브라우저는 새 주소가 올 때까지 앞 사진을 그대로 둔다.
 */
function GridImage({
  src,
  showLoading,
}: {
  src: string;
  showLoading: boolean;
}) {
  const [shown, setShown] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  return (
    <>
      <img
        src={src}
        alt=""
        crossOrigin="anonymous"
        loading="lazy"
        decoding="async"
        className={cn(
          "size-full object-cover",
          (!shown || failed) && "opacity-0",
        )}
        onLoad={() => {
          setShown(true);
          setFailedSrc(null);
        }}
        onError={() => setFailedSrc(src)}
      />
      {failed ? (
        <TileMark failed />
      ) : !shown && showLoading ? (
        <TileMark />
      ) : null}
    </>
  );
}

/** 사진 칸 가운데의 표시. 받는 중이면 스피너, 받지 못했으면 깨진 사진이다. */
function TileMark({ failed = false }: { failed?: boolean }) {
  return (
    <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
      {failed ? <ImageOffIcon aria-hidden className="size-6" /> : <Spinner />}
    </span>
  );
}

/**
 * 내려받아 형식을 확인한 Blob URL. 다 쓰면 거둔다. `attempt`가 0이면 아직 받지 않고, 늘리면 다시
 * 받는다. 불러오지 못한 뒤 재생을 다시 누르면 새로 시도한다.
 */
function usePlayableUrl(
  attachment: MessageAttachment,
  attempt: number,
  enabled: boolean,
) {
  const [state, setState] = useState<
    | { attempt: number; status: "unsupported" | "failed" }
    | { attempt: number; status: "ready"; url: string }
    | null
  >(null);
  const active = enabled && attempt > 0;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let created: string | null = null;
    loadPlayableAttachment(attachment).then(
      (url) => {
        created = url;
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        setState(
          url
            ? { attempt, status: "ready", url }
            : { attempt, status: "unsupported" },
        );
      },
      () => {
        if (!cancelled) setState({ attempt, status: "failed" });
      },
    );
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [attachment, attempt, active]);

  if (!active) return { status: "idle" } as const;
  // 이번 시도의 결과가 오기 전까지는 불러오는 중이다.
  return state?.attempt === attempt ? state : ({ status: "loading" } as const);
}

function AudioAttachment({
  attachment,
  pending,
  cornerClassName,
}: {
  attachment: MessageAttachment;
  pending: boolean;
  cornerClassName: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const state = usePlayableUrl(attachment, attempt, !pending);

  if (state.status === "ready") {
    return (
      <AudioPlayer
        src={state.url}
        fileName={attachment.fileName}
        cornerClassName={cornerClassName}
      />
    );
  }

  return (
    <div className={cn(AUDIO_CARD_CLASS_NAME, cornerClassName)}>
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
          onClick={() => setAttempt((current) => current + 1)}
        >
          <PlayIcon aria-hidden />
        </Button>
      )}
    </div>
  );
}

const AUDIO_CARD_CLASS_NAME =
  "flex w-64 max-w-full items-center gap-2 rounded-2xl bg-muted px-3 py-2.5";

/**
 * 불러온 오디오를 재생 전 카드와 같은 모양으로 재생한다. 브라우저 기본 재생기로 바꿔 끼우면 누르는 순간
 * 카드 모양이 달라진다. 재생 버튼은 재생 전과 같은 오른쪽 자리에 둔다.
 */
function AudioPlayer({
  src,
  fileName,
  cornerClassName,
}: {
  src: string;
  fileName: string;
  cornerClassName: string;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // WebM 녹음은 끝까지 읽기 전에는 길이가 Infinity로 온다.
  const knownDuration = Number.isFinite(duration) && duration > 0;

  return (
    <div className={cn(AUDIO_CARD_CLASS_NAME, cornerClassName)}>
      <MusicIcon
        aria-hidden
        className="size-5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{fileName}</span>
        <span className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={knownDuration ? duration : 0}
            step="any"
            value={currentTime}
            disabled={!knownDuration}
            aria-label={`재생 위치: ${fileName}`}
            className="h-4 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-default"
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (audio.current) audio.current.currentTime = next;
              setCurrentTime(next);
            }}
          />
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatPlaybackTime(currentTime)}
            {knownDuration ? ` / ${formatPlaybackTime(duration)}` : null}
          </span>
        </span>
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="rounded-full"
        aria-label={playing ? `일시 정지: ${fileName}` : `재생: ${fileName}`}
        onClick={() => {
          const element = audio.current;
          if (!element) return;
          if (element.paused)
            void element.play().catch(() => setPlaying(false));
          else element.pause();
        }}
      >
        {playing ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
      </Button>
      <audio
        ref={audio}
        src={src}
        autoPlay
        hidden
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) =>
          setCurrentTime(event.currentTarget.currentTime)
        }
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
      >
        {/* 사용자가 보낸 오디오라 자막 파일이 없다. */}
        <track kind="captions" />
      </audio>
    </div>
  );
}

/** 재생 시각 "1:05". 한 시간을 넘으면 "1:02:05". */
function formatPlaybackTime(seconds: number): string {
  const total = Math.floor(Number.isFinite(seconds) ? seconds : 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}

function FileAttachment({
  attachment,
  url,
  pending,
  cornerClassName,
}: {
  attachment: MessageAttachment;
  url: string | undefined;
  pending: boolean;
  cornerClassName: string;
}) {
  const download = useManagedDownload();
  const status = managedDownloadLabel(download.state);
  const content = (
    <>
      <FileIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{attachment.fileName}</span>
        <span className="block text-xs text-muted-foreground">
          {formatFileSize(attachment.sizeBytes)}
        </span>
        <DownloadNote state={download.state} />
      </span>
      {/* 올리는 동안은 사진처럼 돌아가는 표시를 둔다. 흐리게만 그리면 멈춘 것처럼 보인다. */}
      {pending ? <Spinner /> : <DownloadStatus state={download.state} />}
    </>
  );
  const className = cn(
    "flex w-64 max-w-full items-center gap-2 rounded-2xl bg-muted px-3 py-2.5 text-left",
    cornerClassName,
  );

  return url ? (
    <a
      href={toDownloadUrl(url, attachment.fileName)}
      onClick={(event) => {
        // 올리는 중에는 아직 받을 파일이 없다. 업로드 표시 뒤에서 다운로드가 돌지 않게 막는다.
        if (pending) {
          event.preventDefault();
          return;
        }
        const previewed = previewDocumentOnClick(event, {
          url,
          downloadUrl: event.currentTarget.href,
          fileName: attachment.fileName,
        });
        if (previewed) return;
        download.handleClick(event, [{ url, fileName: attachment.fileName }]);
      }}
      aria-label={`${status ?? "내려받기"}: ${attachment.fileName}`}
      aria-busy={download.state.status === "loading" || undefined}
      className={cn(className, "hover:bg-muted/70")}
    >
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

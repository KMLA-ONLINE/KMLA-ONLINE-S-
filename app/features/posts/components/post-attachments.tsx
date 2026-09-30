import {
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  FileIcon,
  FilesIcon,
  FileTextIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  imageDownloadName,
  toAttachmentDownloadUrl,
} from "~/features/posts/model/attachments";
import { formatFileSize } from "~/features/posts/model/format";
import type { PostAttachment } from "~/features/posts/model/types";
import type { ViewerImage } from "~/shared/components/image-viewer";
import { useImageViewerParam } from "~/shared/hooks/use-image-viewer-param";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";

const VISIBLE_TILE_LIMIT = 5;

/** 타일 개수별 그리드. 화면 폭이 아니라 장수가 배치를 정한다. */
function containerClass(count: number): string {
  // 한 장일 때만 위아래로 테두리를 긋는다(좌우는 카드 테두리와 겹친다). `aspect-video`는 치수를 모르는 첨부의 폴백이다.
  if (count === 1) return "aspect-video border-y";
  if (count === 2) return "grid aspect-[2/1] grid-cols-2 gap-1";
  if (count <= 4) return "grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-1";
  return "grid aspect-[4/3] grid-cols-6 grid-rows-2 gap-1";
}

/** 한 장일 때 허용하는 가로세로비 범위. 16:9 고정은 세로 사진이 잘리고 원본 그대로는 9:16 캡처가 피드를 밀어내 이 범위로 자른다(하한 3:4는 폰 기본 세로비). */
const SINGLE_IMAGE_WIDEST = 16 / 9;
const SINGLE_IMAGE_TALLEST = 3 / 4;

/** 한 장일 때 컨테이너 가로세로비. 치수가 없으면 null이고 `containerClass`의 `aspect-video`가 남는다. */
function singleImageRatio(image: PostAttachment): number | null {
  if (!image.width || !image.height) return null;
  return Math.min(
    SINGLE_IMAGE_WIDEST,
    Math.max(SINGLE_IMAGE_TALLEST, image.width / image.height),
  );
}

function tileClass(count: number, index: number): string {
  if (count === 3 && index === 0) return "row-span-2";
  if (count >= 5) return index < 2 ? "col-span-3" : "col-span-2";
  return "";
}

export function PostImageGrid({
  images,
  className,
  allowOriginalTile = false,
}: {
  images: PostAttachment[];
  className?: string;
  /** 전폭 한 장짜리 타일에 한해 원본을 그린다(상세만 켬). 축소본(800px)은 그 폭에서 흐리고, 두 장부터는 충분하다. */
  allowOriginalTile?: boolean;
}) {
  // signed URL을 못 받은 첨부는 뷰어에 넣지 않는다. 슬라이드에 빈 칸이 생기고 좌우 이동이
  // 어긋나느니, 그리드에서만 깨진 타일로 보이는 편이 낫다.
  const viewerImages = useMemo<ViewerImage[]>(
    () =>
      images
        .filter((item) => item.signedUrl !== null)
        .map((item) => {
          const downloadName = imageDownloadName(item.attachment_id);
          return {
            id: item.attachment_id,
            src: item.signedUrl!,
            thumbSrc: item.thumbnailUrl ?? undefined,
            downloadSrc: toAttachmentDownloadUrl(item.signedUrl!, downloadName),
            name: downloadName,
            width: item.width ?? undefined,
            height: item.height ?? undefined,
          };
        }),
    [images],
  );
  // attachment_id가 전역 유일하므로 같은 첨부가 카드와 상세에 있어도 전역 host가 하나만 연다.
  const viewer = useImageViewerParam(viewerImages, { downloadAll: true });

  if (images.length === 0) return null;

  const visible = images.slice(0, VISIBLE_TILE_LIMIT);
  const overflow = images.length - visible.length;
  // 임의의 실수라 클래스로 못 적어 인라인 스타일이 `aspect-video`를 덮는다. 치수는 업로드 때 저장해 두어 로드 후 레이아웃이 튀지 않는다.
  const singleRatio =
    visible.length === 1 ? singleImageRatio(visible[0]) : null;
  // 원본을 쓸지는 화면이 아니라 타일 크기가 정한다. 근거는 `allowOriginalTile` 주석에 있다.
  const tileUsesOriginal = allowOriginalTile && visible.length === 1;

  return (
    <>
      <div
        data-testid="post-image-grid"
        className={cn("bg-muted", containerClass(visible.length), className)}
        style={singleRatio === null ? undefined : { aspectRatio: singleRatio }}
      >
        {visible.map((item, index) => {
          const isLastVisible = index === visible.length - 1;

          return (
            <button
              key={item.attachment_id}
              type="button"
              disabled={item.signedUrl === null}
              onClick={() => viewer.open(item.attachment_id)}
              aria-label={`${item.original_filename} 크게 보기`}
              className={cn(
                "relative block h-full w-full overflow-hidden focus:outline-none",
                tileClass(visible.length, index),
              )}
            >
              {item.signedUrl ? (
                <img
                  // 타일은 축소본을 그린다. 원본(3072px)을 받으면 보이는 픽셀의 몇 배를 내려받는다. 축소본이 없으면 원본으로 떨어지고, 뷰어는 원본을 연다.
                  src={
                    tileUsesOriginal
                      ? item.signedUrl
                      : (item.thumbnailUrl ?? item.signedUrl)
                  }
                  alt={item.original_filename}
                  crossOrigin="anonymous"
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-muted px-2 text-center text-xs text-muted-foreground">
                  이미지를 불러오지 못했습니다
                </span>
              )}
              {overflow > 0 && isLastVisible ? (
                <span className="absolute inset-0 flex items-center justify-center bg-foreground/60 text-lg font-semibold text-background">
                  +{overflow}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

function fileIcon(mimeType: string) {
  if (mimeType === "application/pdf" || mimeType.startsWith("text/")) {
    return FileTextIcon;
  }
  return FileIcon;
}

export function PostFileList({ files }: { files: PostAttachment[] }) {
  const [expanded, setExpanded] = useState(false);
  if (files.length === 0) return null;
  const canExpand = files.length > 3;
  const visibleFiles = expanded ? files : files.slice(0, 3);

  return (
    <section className="border-t pt-2" aria-label="첨부 파일">
      <div className="flex items-center gap-2 px-1.5 pb-1.5">
        <FilesIcon
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <h3 className="text-sm font-medium">첨부 파일 {files.length}개</h3>
      </div>
      <ul className="divide-y">
        {visibleFiles.map((item) => {
          const Icon = fileIcon(item.mime_type);

          return (
            <li key={item.attachment_id} className="min-w-0">
              {item.signedUrl ? (
                <a
                  href={toAttachmentDownloadUrl(
                    item.signedUrl,
                    item.original_filename,
                  )}
                  download={item.original_filename}
                  className="group flex min-w-0 items-center gap-3 rounded-md px-1.5 py-2.5 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <FileBadge icon={<Icon aria-hidden="true" />} />
                  <FileMeta
                    name={item.original_filename}
                    sizeBytes={item.size_bytes}
                    mimeType={item.mime_type}
                  />
                  <DownloadIcon
                    className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                    aria-hidden="true"
                  />
                </a>
              ) : (
                <div className="flex min-w-0 items-center gap-3 px-1.5 py-2.5 text-muted-foreground">
                  <FileBadge icon={<Icon aria-hidden="true" />} />
                  <FileMeta
                    name={item.original_filename}
                    sizeBytes={item.size_bytes}
                    mimeType={item.mime_type}
                  />
                  <span className="shrink-0 text-xs">다운로드할 수 없음</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {canExpand ? (
        <div className="border-t pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start px-1.5"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? (
              <ChevronUpIcon data-icon="inline-start" />
            ) : (
              <ChevronDownIcon data-icon="inline-start" />
            )}
            {expanded ? "파일 목록 접기" : `파일 ${files.length}개 모두 보기`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function FileBadge({ icon }: { icon: React.ReactNode }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&>svg]:size-4.5">
      {icon}
    </span>
  );
}

function FileMeta({
  name,
  sizeBytes,
  mimeType,
}: {
  name: string;
  sizeBytes: number;
  mimeType: string;
}) {
  const typeLabel = mimeType === "application/pdf" ? "PDF" : "파일";
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium" title={name}>
        {name}
      </p>
      <p className="text-xs text-muted-foreground">
        {typeLabel} · {formatFileSize(sizeBytes)}
      </p>
    </div>
  );
}

import { DownloadIcon, FileIcon, FileTextIcon } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import { toAttachmentDownloadUrl } from "~/features/posts/model/attachments";
import { formatFileSize } from "~/features/posts/model/format";
import type { PostAttachment } from "~/features/posts/model/types";
import {
  ImageViewer,
  type ViewerImage,
} from "~/shared/components/image-viewer";
import { cn } from "~/shared/lib/utils";

/** 업로드 파이프라인이 사진을 webp로 정규화하므로, 이미지인지 아닌지는 이 한 줄로 갈린다. */
const IMAGE_MIME = "image/webp";

/** 뷰어를 연 것이 우리라는 표식. 뒤로가기로 닫을 수 있는지 판단하는 근거다. */
interface ImageViewerLocationState {
  imageViewerPushed?: boolean;
}

const VISIBLE_TILE_LIMIT = 5;

export function splitPostAttachments(attachments: PostAttachment[]) {
  return {
    images: attachments.filter((item) => item.mime_type === IMAGE_MIME),
    files: attachments.filter((item) => item.mime_type !== IMAGE_MIME),
  };
}

/**
 * 타일 개수별 그리드. 반응형이 아니라 장수의 함수다 — 사진이 몇 장이냐에 따라 "보기 좋은
 * 배치"가 정해져 있고, 화면 폭이 그걸 바꾸지는 않는다.
 */
function containerClass(count: number): string {
  if (count === 1) return "aspect-video";
  if (count === 2) return "grid aspect-[2/1] grid-cols-2 gap-1";
  if (count <= 4) return "grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-1";
  return "grid aspect-[4/3] grid-cols-6 grid-rows-2 gap-1";
}

/** 3장일 때 첫 장이 왼쪽 전체, 5장 이상일 때 윗줄 2장이 절반씩. */
function tileClass(count: number, index: number): string {
  if (count === 3 && index === 0) return "row-span-2";
  if (count >= 5) return index < 2 ? "col-span-3" : "col-span-2";
  return "";
}

export function PostImageGrid({
  images,
  className,
}: {
  images: PostAttachment[];
  className?: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  if (images.length === 0) return null;

  // signed URL을 못 받은 첨부는 뷰어에 넣지 않는다. 슬라이드에 빈 칸이 생기고 좌우 이동이
  // 어긋나느니, 그리드에서만 깨진 타일로 보이는 편이 낫다.
  const viewerImages: ViewerImage[] = images
    .filter((item) => item.signedUrl !== null)
    .map((item) => ({
      id: item.attachment_id,
      src: item.signedUrl!,
      downloadSrc: toAttachmentDownloadUrl(
        item.signedUrl!,
        item.original_filename,
      ),
      name: item.original_filename,
    }));

  const requestedImageId = searchParams.get("image");
  // 카드 피드에는 게시물이 여럿이라 모두가 같은 search param을 본다. attachment_id는 전역
  // 유일하므로, 자기 첨부가 아니면 여기서 걸러진다.
  const openImageId =
    requestedImageId !== null &&
    viewerImages.some((image) => image.id === requestedImageId)
      ? requestedImageId
      : null;

  const openViewer = (attachmentId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("image", attachmentId);
    void setSearchParams(next, {
      preventScrollReset: true,
      state: { imageViewerPushed: true } satisfies ImageViewerLocationState,
    });
  };

  const closeViewer = () => {
    // 우리가 push한 entry라면 뒤로가기로 닫는 게 맞다 — 안드로이드 back 제스처와 PWA의
    // 뒤로가기가 그대로 동작한다. 링크를 직접 열어 들어온 경우엔 pop할 게 없으니 param만 지운다.
    const state = location.state as ImageViewerLocationState | null;
    if (state?.imageViewerPushed) {
      void navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("image");
    void setSearchParams(next, { replace: true, preventScrollReset: true });
  };

  const visible = images.slice(0, VISIBLE_TILE_LIMIT);
  const overflow = images.length - visible.length;

  return (
    <>
      <div
        className={cn("bg-muted", containerClass(visible.length), className)}
      >
        {visible.map((item, index) => {
          const isLastVisible = index === visible.length - 1;

          return (
            <button
              key={item.attachment_id}
              type="button"
              disabled={item.signedUrl === null}
              onClick={() => openViewer(item.attachment_id)}
              aria-label={`${item.original_filename} 크게 보기`}
              className={cn(
                "relative block h-full w-full overflow-hidden focus:outline-none",
                tileClass(visible.length, index),
              )}
            >
              {item.signedUrl ? (
                <img
                  src={item.signedUrl}
                  alt={item.original_filename}
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

      <ImageViewer
        images={viewerImages}
        openImageId={openImageId}
        onClose={closeViewer}
      />
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
  if (files.length === 0) return null;

  return (
    <ul className="flex flex-col gap-2">
      {files.map((item) => {
        const Icon = fileIcon(item.mime_type);

        return (
          <li key={item.attachment_id}>
            {item.signedUrl ? (
              <a
                href={toAttachmentDownloadUrl(
                  item.signedUrl,
                  item.original_filename,
                )}
                download={item.original_filename}
                className="flex items-center gap-3 rounded-lg border p-2 transition-colors hover:bg-muted"
              >
                <FileBadge icon={<Icon className="size-4.5" />} />
                <FileMeta
                  name={item.original_filename}
                  sizeBytes={item.size_bytes}
                />
                <DownloadIcon className="size-4 shrink-0 text-muted-foreground" />
              </a>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border p-2 text-muted-foreground">
                <FileBadge icon={<Icon className="size-4.5" />} />
                <FileMeta
                  name={item.original_filename}
                  sizeBytes={item.size_bytes}
                />
                <span className="shrink-0 text-xs">다운로드할 수 없음</span>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function FileBadge({ icon }: { icon: React.ReactNode }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
      {icon}
    </span>
  );
}

function FileMeta({ name, sizeBytes }: { name: string; sizeBytes: number }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{name}</p>
      <p className="text-xs text-muted-foreground">
        {formatFileSize(sizeBytes)}
      </p>
    </div>
  );
}

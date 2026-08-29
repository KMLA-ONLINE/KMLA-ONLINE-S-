import { DownloadIcon, FileIcon, FileTextIcon } from "lucide-react";

import {
  imageDownloadName,
  toAttachmentDownloadUrl,
} from "~/features/posts/model/attachments";
import { formatFileSize } from "~/features/posts/model/format";
import type { PostAttachment } from "~/features/posts/model/types";
import {
  ImageViewer,
  type ViewerImage,
} from "~/shared/components/image-viewer";
import { useImageViewerParam } from "~/shared/hooks/use-image-viewer-param";
import { cn } from "~/shared/lib/utils";

/** 업로드 파이프라인이 사진을 webp로 정규화하므로, 이미지인지 아닌지는 이 한 줄로 갈린다. */
const IMAGE_MIME = "image/webp";

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
  // 한 장일 때만 테두리를 둘러 여백과 사진의 경계를 알린다. 좌우는 카드 폭에 꽉 차서 선이
  // 카드 테두리와 겹쳐 두 줄로 보이므로 위아래만 긋는다. `aspect-video`는 치수를 모르는
  // 첨부를 위한 폴백이다 — 아는 경우엔 `singleImageRatio`가 인라인 스타일로 덮는다.
  if (count === 1) return "aspect-video border-y";
  if (count === 2) return "grid aspect-[2/1] grid-cols-2 gap-1";
  if (count <= 4) return "grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-1";
  return "grid aspect-[4/3] grid-cols-6 grid-rows-2 gap-1";
}

/**
 * 사진이 한 장일 때 허용하는 가로세로비의 양 끝.
 *
 * 한 장짜리는 사진 자체가 게시물의 내용이라 되도록 원본 그대로 보여 주는 편이 낫다. 16:9로
 * 못 박으면 흔한 세로 사진(3:4)이 절반 넘게 잘려 나간다. 그렇다고 원본 비율을 그대로 따르면
 * 9:16 스크린샷 한 장이 카드 폭의 1.78배 높이를 차지해서, 목록에서 아래 게시물을 화면 밖으로
 * 밀어낸다 — 이 그리드는 상세뿐 아니라 피드·그룹·프로필 카드에서도 쓰인다. 그래서 원본 비율을
 * 이 범위로 자른다. 아래 끝을 3:4에 둔 것은 폰 카메라의 기본 세로비라 가장 흔하기 때문이다.
 * 4:3, 1:1, 3:4는 손실 없이 다 보이고, 파노라마와 긴 캡처만 끝에서 크롭된다.
 */
const SINGLE_IMAGE_WIDEST = 16 / 9;
const SINGLE_IMAGE_TALLEST = 3 / 4;

/**
 * 한 장일 때 컨테이너에 실을 가로세로비. 업로드 때 잰 치수가 없으면(옛 첨부, 메타를 못 읽은
 * 경우) null이고, 그러면 `containerClass`의 `aspect-video`가 그대로 남는다.
 */
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
}: {
  images: PostAttachment[];
  className?: string;
}) {
  // signed URL을 못 받은 첨부는 뷰어에 넣지 않는다. 슬라이드에 빈 칸이 생기고 좌우 이동이
  // 어긋나느니, 그리드에서만 깨진 타일로 보이는 편이 낫다.
  const viewerImages: ViewerImage[] = images
    .filter((item) => item.signedUrl !== null)
    .map((item) => {
      const downloadName = imageDownloadName(item.attachment_id);
      return {
        id: item.attachment_id,
        src: item.signedUrl!,
        downloadSrc: toAttachmentDownloadUrl(item.signedUrl!, downloadName),
        name: downloadName,
      };
    });
  // attachment_id가 전역 유일하므로, 한 화면에 카드가 여럿이어도 자기 첨부만 연다.
  const viewer = useImageViewerParam(viewerImages);

  if (images.length === 0) return null;

  const visible = images.slice(0, VISIBLE_TILE_LIMIT);
  const overflow = images.length - visible.length;
  // 임의의 실수라 클래스로는 못 적는다. 인라인 스타일이 `aspect-video`를 덮고, 값이 없으면
  // 그 폴백이 그대로 쓰인다. 치수는 업로드 때 재서 저장해 두므로 이미지가 도착하기 전에
  // 높이가 정해진다 — 로드 후 레이아웃이 튀지 않는다.
  const singleRatio =
    visible.length === 1 ? singleImageRatio(visible[0]) : null;

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
        openImageId={viewer.openImageId}
        onClose={viewer.close}
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

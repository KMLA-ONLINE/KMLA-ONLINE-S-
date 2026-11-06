import { useMemo } from "react";

import {
  imageDownloadName,
  toAttachmentDownloadUrl,
} from "~/features/posts/model/attachments";
import type { CommentImage as CommentImageModel } from "~/features/posts/model/types";
import type { ViewerImage } from "~/shared/components/image-viewer";
import { useImageViewerParam } from "~/shared/hooks/use-image-viewer-param";

/** 댓글 이미지가 그려질 최대 높이(`max-h-80`과 같은 320px). */
const COMMENT_IMAGE_MAX_HEIGHT = 320;

/**
 * 사진이 오기 전에 자리를 잡아 둔다. 크기 없이 `lazy` 사진을 두면 늦게 뜰 때 아래 댓글이 밀린다.
 * 높이 상한은 너비로 바꿔 건다. `max-height`로 자르면 상자 너비는 원본 그대로 남아 옆이 빈다.
 */
function commentImageFrame(width: number, height: number) {
  if (!(width > 0 && height > 0)) return undefined;
  return {
    aspectRatio: `${width} / ${height}`,
    width: Math.min(width, (COMMENT_IMAGE_MAX_HEIGHT * width) / height),
  };
}

export function CommentImage({ image }: { image: CommentImageModel }) {
  const downloadName = imageDownloadName(image.image_id);
  const viewerImages = useMemo<ViewerImage[]>(
    () =>
      image.signedUrl
        ? [
            {
              id: image.image_id,
              src: image.signedUrl,
              downloadSrc: toAttachmentDownloadUrl(
                image.signedUrl,
                downloadName,
              ),
              name: downloadName,
              width: image.width,
              height: image.height,
            },
          ]
        : [],
    [downloadName, image.height, image.image_id, image.signedUrl, image.width],
  );
  // 서명에 실패해 목록이 비면 전역 host가 해당 URL을 열지 않는다.
  const viewer = useImageViewerParam(viewerImages);
  const frame = commentImageFrame(image.width, image.height);

  return (
    <button
      type="button"
      disabled={!image.signedUrl}
      aria-label="댓글 이미지 크게 보기"
      className="mt-1 block max-w-full overflow-hidden rounded-xl bg-muted focus:ring-0 focus:outline-none focus-visible:ring-0"
      onClick={() => viewer.open(image.image_id)}
    >
      {image.signedUrl ? (
        <img
          src={image.signedUrl}
          alt="댓글 이미지"
          crossOrigin="anonymous"
          loading="lazy"
          width={image.width}
          height={image.height}
          style={frame}
          className="h-auto max-h-80 max-w-full object-contain"
        />
      ) : (
        <span className="block px-3 py-8 text-xs text-muted-foreground">
          이미지를 불러오지 못했습니다
        </span>
      )}
    </button>
  );
}

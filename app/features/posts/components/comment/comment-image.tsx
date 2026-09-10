import {
  imageDownloadName,
  toAttachmentDownloadUrl,
} from "~/features/posts/model/attachments";
import type { CommentImage as CommentImageModel } from "~/features/posts/model/types";
import { ImageViewer } from "~/shared/components/image-viewer";
import { useImageViewerParam } from "~/shared/hooks/use-image-viewer-param";

export function CommentImage({ image }: { image: CommentImageModel }) {
  const downloadName = imageDownloadName(image.image_id);
  const viewerImages = image.signedUrl
    ? [
        {
          id: image.image_id,
          src: image.signedUrl,
          downloadSrc: toAttachmentDownloadUrl(image.signedUrl, downloadName),
          name: downloadName,
        },
      ]
    : [];
  // 서명에 실패해 목록이 비면 훅이 `openImageId`를 걸러 준다 — 열 수 없는 뷰어가 뜨지 않는다.
  const viewer = useImageViewerParam(viewerImages);

  return (
    <>
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
            className="max-h-80 max-w-full object-contain"
          />
        ) : (
          <span className="block px-3 py-8 text-xs text-muted-foreground">
            이미지를 불러오지 못했습니다
          </span>
        )}
      </button>
      <ImageViewer
        images={viewerImages}
        openImageId={viewer.openImageId}
        onClose={viewer.close}
      />
    </>
  );
}

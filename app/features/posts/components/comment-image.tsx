import { useLocation, useNavigate, useSearchParams } from "react-router";

import { toAttachmentDownloadUrl } from "~/features/posts/model/attachments";
import type { CommentImage as CommentImageModel } from "~/features/posts/model/types";
import { ImageViewer } from "~/shared/components/image-viewer";

interface ImageViewerLocationState {
  imageViewerPushed?: boolean;
}

const DOWNLOAD_NAME = "comment-image.webp";

export function CommentImage({ image }: { image: CommentImageModel }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const open = searchParams.get("image") === image.image_id;
  const viewerImages = image.signedUrl
    ? [
        {
          id: image.image_id,
          src: image.signedUrl,
          downloadSrc: toAttachmentDownloadUrl(image.signedUrl, DOWNLOAD_NAME),
          name: DOWNLOAD_NAME,
        },
      ]
    : [];

  const close = () => {
    const state = location.state as ImageViewerLocationState | null;
    if (state?.imageViewerPushed) {
      void navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("image");
    void setSearchParams(next, { replace: true, preventScrollReset: true });
  };

  return (
    <>
      <button
        type="button"
        disabled={!image.signedUrl}
        aria-label="댓글 이미지 크게 보기"
        className="mt-1 block max-w-full overflow-hidden rounded-xl bg-muted focus:ring-0 focus:outline-none focus-visible:ring-0"
        onClick={() => {
          const next = new URLSearchParams(searchParams);
          next.set("image", image.image_id);
          void setSearchParams(next, {
            preventScrollReset: true,
            state: {
              imageViewerPushed: true,
            } satisfies ImageViewerLocationState,
          });
        }}
      >
        {image.signedUrl ? (
          <img
            src={image.signedUrl}
            alt="댓글 이미지"
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
        openImageId={open && viewerImages.length > 0 ? image.image_id : null}
        onClose={close}
      />
    </>
  );
}

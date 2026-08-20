import { useLocation, useNavigate, useSearchParams } from "react-router";

import type { ProfilePost } from "~/features/posts/model/types";
import {
  ImageViewer,
  type ViewerImage,
} from "~/shared/components/image-viewer";
import { cn } from "~/shared/lib/utils";

interface ImageViewerLocationState {
  imageViewerPushed?: boolean;
}

export function ProfileMediaActivity({
  post,
  className,
}: {
  post: ProfilePost;
  className?: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  if (!post.activity_kind) return null;

  const isAvatar = post.activity_kind === "avatar_changed";
  const label = isAvatar ? "프로필 사진" : "프로필 커버";
  const imageId = `profile-activity-${post.post_id}`;
  const imageName = `${profileName(post)}님이 변경한 ${label}`;
  const viewerImages: ViewerImage[] = post.activity_media_url
    ? [
        {
          id: imageId,
          src: post.activity_media_url,
          downloadSrc: post.activity_media_url,
          name: imageName,
        },
      ]
    : [];
  const openImageId = searchParams.get("image") === imageId ? imageId : null;

  const openViewer = () => {
    const next = new URLSearchParams(searchParams);
    next.set("image", imageId);
    void setSearchParams(next, {
      preventScrollReset: true,
      state: { imageViewerPushed: true } satisfies ImageViewerLocationState,
    });
  };

  const closeViewer = () => {
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
      {post.activity_media_url ? (
        <button
          type="button"
          data-testid="profile-media-activity"
          aria-label={`${label} 크게 보기`}
          onClick={openViewer}
          className={cn(
            "flex w-full items-center justify-center overflow-hidden bg-muted focus:ring-0 focus:outline-none",
            isAvatar ? "aspect-square" : "aspect-[3/1]",
            className,
          )}
        >
          <img
            src={post.activity_media_url}
            alt={imageName}
            loading="lazy"
            className="size-full object-cover"
          />
        </button>
      ) : (
        <div
          data-testid="profile-media-activity"
          className={cn(
            "flex w-full items-center justify-center overflow-hidden bg-muted",
            isAvatar ? "aspect-square" : "aspect-[3/1]",
            className,
          )}
        >
          <p className="px-4 text-center text-sm text-muted-foreground">
            이미지를 불러오지 못했습니다
          </p>
        </div>
      )}

      <ImageViewer
        images={viewerImages}
        openImageId={openImageId}
        onClose={closeViewer}
      />
    </>
  );
}

function profileName(post: ProfilePost): string {
  return post.author_name ?? "사용자";
}

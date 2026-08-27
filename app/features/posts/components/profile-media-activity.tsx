import {
  imageDownloadName,
  toAttachmentDownloadUrl,
} from "~/features/posts/model/attachments";
import type { ProfilePost } from "~/features/posts/model/types";
import {
  ImageViewer,
  type ViewerImage,
} from "~/shared/components/image-viewer";
import { useImageViewerParam } from "~/shared/hooks/use-image-viewer-param";
import { cn } from "~/shared/lib/utils";

type ProfileMediaActivityPost = Pick<
  ProfilePost,
  "activity_kind" | "activity_media_url" | "author_name" | "post_id"
>;

export function ProfileMediaActivity({
  post,
  className,
}: {
  post: ProfileMediaActivityPost;
  className?: string;
}) {
  const imageId = `profile-activity-${post.post_id}`;
  const downloadName = imageDownloadName(post.post_id);
  const viewerImages: ViewerImage[] = post.activity_media_url
    ? [
        {
          id: imageId,
          src: post.activity_media_url,
          downloadSrc: toAttachmentDownloadUrl(
            post.activity_media_url,
            downloadName,
          ),
          name: downloadName,
        },
      ]
    : [];
  const viewer = useImageViewerParam(viewerImages);

  if (!post.activity_kind) return null;

  const isAvatar = post.activity_kind === "avatar_changed";
  const label = isAvatar ? "프로필 사진" : "프로필 커버";
  const imageName = `${profileName(post)}님이 변경한 ${label}`;

  return (
    <>
      {post.activity_media_url ? (
        <button
          type="button"
          data-testid="profile-media-activity"
          aria-label={`${label} 크게 보기`}
          onClick={() => viewer.open(imageId)}
          className={cn(
            "flex w-full items-center justify-center overflow-hidden border-y border-border/60 bg-muted focus:ring-0 focus:outline-none",
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
        openImageId={viewer.openImageId}
        onClose={viewer.close}
      />
    </>
  );
}

function profileName(post: ProfileMediaActivityPost): string {
  return post.author_name ?? "사용자";
}

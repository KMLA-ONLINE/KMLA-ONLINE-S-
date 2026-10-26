import { useMemo } from "react";

import { useUnavailableMediaLabel } from "~/features/posts/hooks/use-media-pending";
import {
  imageDownloadName,
  toAttachmentDownloadUrl,
} from "~/features/posts/model/attachments";
import type { ProfilePost } from "~/features/posts/model/types";
import type { ViewerImage } from "~/shared/components/image-viewer";
import { useImageViewerParam } from "~/shared/hooks/use-image-viewer-param";
import { useT } from "~/shared/i18n";
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
  const t = useT();
  const unavailableLabel = useUnavailableMediaLabel("image");
  const imageId = `profile-activity-${post.post_id}`;
  const downloadName = imageDownloadName(post.post_id);
  // 아무것도 그리지 않는 경우까지 등록하면 열 수단이 없는 사진이 `?image=`로만 열린다.
  const viewerImages = useMemo<ViewerImage[]>(
    () =>
      post.activity_kind && post.activity_media_url
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
        : [],
    [downloadName, imageId, post.activity_kind, post.activity_media_url],
  );
  const viewer = useImageViewerParam(viewerImages);

  if (!post.activity_kind) return null;

  const isAvatar = post.activity_kind === "avatar_changed";
  const label = isAvatar ? t("프로필 사진") : t("프로필 커버");
  const imageName = t("{name}님이 변경한 {label}", {
    name: post.author_name ?? t("사용자"),
    label,
  });

  return post.activity_media_url ? (
    <button
      type="button"
      data-testid="profile-media-activity"
      aria-label={t("{label} 크게 보기", { label })}
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
        crossOrigin="anonymous"
        loading="lazy"
        className="size-full object-cover"
      />
    </button>
  ) : (
    <div
      data-testid="profile-media-activity"
      className={cn(
        "flex w-full items-center justify-center overflow-hidden border-y border-border/60 bg-muted",
        isAvatar ? "aspect-square" : "aspect-[3/1]",
        className,
      )}
    >
      <p className="px-4 text-center text-sm text-muted-foreground">
        {unavailableLabel}
      </p>
    </div>
  );
}

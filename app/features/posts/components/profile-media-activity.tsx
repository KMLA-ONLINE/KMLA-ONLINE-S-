import type { ProfilePost } from "~/features/posts/model/types";
import { cn } from "~/shared/lib/utils";

export function ProfileMediaActivity({
  post,
  className,
}: {
  post: ProfilePost;
  className?: string;
}) {
  if (!post.activity_kind) return null;

  const isAvatar = post.activity_kind === "avatar_changed";
  const label = isAvatar ? "프로필 사진" : "프로필 커버";

  return (
    <div
      data-testid="profile-media-activity"
      className={cn(
        "flex w-full items-center justify-center overflow-hidden bg-muted",
        isAvatar ? "aspect-square" : "aspect-[3/1]",
        className,
      )}
    >
      {post.activity_media_url ? (
        <img
          src={post.activity_media_url}
          alt={`${profileName(post)}님이 변경한 ${label}`}
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        <p className="px-4 text-center text-sm text-muted-foreground">
          이미지를 불러오지 못했습니다
        </p>
      )}
    </div>
  );
}

function profileName(post: ProfilePost): string {
  return post.author_name ?? "사용자";
}

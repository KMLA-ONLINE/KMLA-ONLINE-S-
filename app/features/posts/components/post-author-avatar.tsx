import { ShieldCheckIcon, VenetianMaskIcon } from "lucide-react";

import type { PostIdentity } from "~/features/posts/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Avatar, AvatarFallback } from "~/shared/ui/avatar";

/** 게시물 작성 신원에 맞는 아바타. 익명만 별도 아바타이고, 운영진 명의는 실제 작성자 프로필에 배지를 붙인다. */
export function PostAuthorAvatar({
  identity,
  name,
  avatarUrl,
  size = "default",
  className,
}: {
  identity: PostIdentity;
  name: string | null;
  /** 서명된 Storage URL이어야 한다. 원시 path는 상대 경로로 나가 404가 된다. */
  avatarUrl: string | null;
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  if (identity === "anonymous") {
    return <PostAnonymousAvatar size={size} className={className} />;
  }

  return (
    <UserAvatar src={avatarUrl} name={name} size={size} className={className} />
  );
}

const ANONYMOUS_ICON_SIZE = {
  sm: "size-3",
  default: "size-4",
  lg: "size-5",
} as const;

export function PostAnonymousAvatar({
  size = "default",
  className,
}: {
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  return (
    <Avatar size={size} className={className}>
      <AvatarFallback className="bg-primary/80 text-primary-foreground">
        <VenetianMaskIcon
          className={ANONYMOUS_ICON_SIZE[size]}
          aria-hidden="true"
        />
      </AvatarFallback>
    </Avatar>
  );
}

/** 운영진 명의로 **작성하는 중**임을 알리는 입력창 전용 아바타(기능 명세 §8.6). 올라간 글·댓글은 실제 작성자를 보여준다. */
export function PostStaffAvatar({
  size = "default",
  className,
}: {
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  return (
    <Avatar size={size} className={className}>
      <AvatarFallback className="bg-primary text-primary-foreground">
        <ShieldCheckIcon
          className={ANONYMOUS_ICON_SIZE[size]}
          aria-hidden="true"
        />
      </AvatarFallback>
    </Avatar>
  );
}

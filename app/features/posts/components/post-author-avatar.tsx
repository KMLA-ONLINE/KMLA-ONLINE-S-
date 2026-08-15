import { ShieldCheckIcon, VenetianMaskIcon } from "lucide-react";

import type { PostIdentity } from "~/features/posts/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Avatar, AvatarFallback } from "~/shared/ui/avatar";

/**
 * 게시물 작성 신원에 맞는 아바타.
 *
 * 익명만 별도 아바타를 쓴다. 운영진 명의 게시물은 실제 작성자의 프로필을 표시하고
 * 이름 옆 배지로 운영진 명의임을 구분한다.
 */
export function PostAuthorAvatar({
  identity,
  name,
  avatarPath,
  size = "default",
  className,
}: {
  identity: PostIdentity;
  name: string | null;
  avatarPath: string | null;
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  if (identity === "anonymous") {
    return <PostAnonymousAvatar size={size} className={className} />;
  }

  return (
    <UserAvatar
      src={avatarPath}
      name={name}
      size={size}
      className={className}
    />
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

/**
 * 운영진 명의로 **작성하는 중**임을 알리는 아바타.
 *
 * 이미 올라간 운영진 명의 글과 댓글은 실제 작성자의 사진과 이름을 그대로 보여준다(기능 명세
 * §8.6). 이 방패는 입력창에서 "지금 고른 명의가 운영진"이라는 표시로만 쓴다.
 */
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

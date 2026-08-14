import { VenetianMaskIcon } from "lucide-react";

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
    return (
      <Avatar size={size} className={className}>
        <AvatarFallback className="bg-primary/80 text-primary-foreground">
          <VenetianMaskIcon aria-label="익명" />
        </AvatarFallback>
      </Avatar>
    );
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

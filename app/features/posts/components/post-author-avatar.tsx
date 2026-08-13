import { ShieldCheckIcon, VenetianMaskIcon } from "lucide-react";

import type { PostIdentity } from "~/features/posts/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Avatar, AvatarFallback } from "~/shared/ui/avatar";

/**
 * 게시물 작성 신원에 맞는 아바타.
 *
 * 익명과 운영진은 사람 아바타를 쓰지 않는다 — 실루엣을 그리면 "사진을 안 올린 사람"과
 * 구분되지 않는다. 둘 다 채워진 원이지만 익명은 한 단계 옅게 둬서, 한 화면에 섞여 있어도
 * 아이콘을 읽지 않고 밝기만으로 갈라 보인다.
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
  if (identity === "staff") {
    return (
      <Avatar size={size} className={className}>
        <AvatarFallback className="bg-primary text-primary-foreground">
          <ShieldCheckIcon aria-label="운영진" />
        </AvatarFallback>
      </Avatar>
    );
  }

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

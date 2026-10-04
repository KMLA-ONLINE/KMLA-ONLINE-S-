import { UsersIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "~/shared/ui/avatar";

export function GroupAvatar({
  name,
  iconPath,
  className,
}: {
  name: string;
  iconPath: string | null;
  className?: string;
}) {
  return (
    <Avatar className={className}>
      {iconPath ? <AvatarImage src={iconPath} alt="" /> : null}
      <AvatarFallback>
        {name.trim().slice(0, 1) || <UsersIcon aria-hidden />}
      </AvatarFallback>
    </Avatar>
  );
}

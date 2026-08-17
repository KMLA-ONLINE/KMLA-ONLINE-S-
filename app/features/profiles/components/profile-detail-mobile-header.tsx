import { ArrowLeftIcon } from "lucide-react";
import { useNavigate } from "react-router";

import { UserAvatar } from "~/shared/components/user-avatar";
import { useHideOnScroll } from "~/shared/hooks/use-hide-on-scroll";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";

export function ProfileDetailMobileHeader({
  name,
  avatarUrl,
  showBack,
}: {
  name: string;
  avatarUrl: string | null;
  showBack: boolean;
}) {
  const navigate = useNavigate();
  const hidden = useHideOnScroll();

  return (
    <header
      data-slot="profile-detail-mobile-header"
      className={cn(
        "sticky top-0 z-30 flex h-[calc(2.75rem+var(--app-safe-t))] items-center gap-2 border-b bg-background/95 px-1.5 pt-[var(--app-safe-t)] backdrop-blur transition-transform duration-200 ease-out motion-reduce:transition-none md:hidden",
        hidden && "-translate-y-full",
      )}
    >
      {showBack ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="뒤로"
          onClick={() => void navigate(-1)}
        >
          <ArrowLeftIcon />
        </Button>
      ) : null}

      <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
        <UserAvatar
          src={avatarUrl}
          name={name}
          size="sm"
          className="size-7 shrink-0"
        />

        <span className="truncate text-base font-semibold">{name}</span>
      </div>
    </header>
  );
}

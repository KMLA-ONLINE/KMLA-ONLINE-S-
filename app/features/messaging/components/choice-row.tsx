import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/shared/lib/utils";
import { Spinner } from "~/shared/ui/spinner";

/**
 * 대화·사람 목록의 한 줄. 기본은 고르고 푸는 토글이다. `action`이면 누르는 즉시 그곳으로 가는 버튼이라
 * `aria-pressed`를 붙이지 않고, 누른 줄은 여는 동안 스피너를 보인다.
 */
export function ChoiceRow({
  chosen,
  action = false,
  disabled,
  onToggle,
  avatar,
  name,
  description,
}: {
  chosen: boolean;
  action?: boolean;
  disabled: boolean;
  onToggle: () => void;
  avatar: ReactNode;
  name: string;
  description?: string;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={action ? undefined : chosen}
        aria-busy={action && chosen ? true : undefined}
        disabled={disabled}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 disabled:hover:bg-transparent",
          chosen && "bg-primary/10 hover:bg-primary/10",
        )}
        onClick={onToggle}
      >
        {avatar}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          {description ? (
            <span className="block truncate text-xs text-muted-foreground">
              {description}
            </span>
          ) : null}
        </span>
        {!chosen ? null : action ? (
          <Spinner className="shrink-0" />
        ) : (
          <CheckIcon aria-hidden className="size-4 shrink-0 text-primary" />
        )}
      </button>
    </li>
  );
}

/** 목록 자리에 대신 보이는 안내·스피너. */
export function Centered({
  children,
  className,
  role,
}: {
  children: ReactNode;
  className?: string;
  role?: "alert";
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex justify-center py-8 text-center text-sm text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

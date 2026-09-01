import { ChevronRightIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router";

import { cn } from "~/shared/lib/utils";

/** lucide 아이콘이 실제로 받는 props만 좁게 요구한다. */
type RowIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

interface ListLinkRowProps {
  to: string;
  label: string;
  icon: RowIcon;
  trailing?: ReactNode;
  className?: string;
}

/**
 * 카드 안에 쌓여 다음 화면으로 넘기는 목록 행.
 *
 * 아이콘 · 라벨 · 오른쪽 화살표 조합이 메뉴와 설정에서 같은 모양으로 반복되므로 한 벌만
 * 둔다. 행 사이 구분선은 이 컴포넌트가 아니라 감싸는 카드의 `divide-y`가 그린다 —
 * 마지막 행에만 선이 남는 실수를 컴포넌트 쪽에서 만들 수 없게 하려는 것이다.
 */
export function ListLinkRow({
  to,
  label,
  icon: Icon,
  trailing,
  className,
}: ListLinkRowProps) {
  return (
    <Link
      to={to}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60",
        className,
      )}
    >
      <Icon className="size-4.5 shrink-0 text-muted-foreground" aria-hidden />

      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {label}
      </span>

      {trailing}

      <ChevronRightIcon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
    </Link>
  );
}

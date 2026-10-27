import { ChevronUpIcon, InfoIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/shared/ui/tooltip";

/**
 * 그룹 게시물 탭 위의 접을 수 있는 묶음. 머리줄은 페이스북 그룹의 "대표 콘텐츠 ⓘ … ^"를 따른다.
 * 접힘은 저장하지 않는다. 부모가 `collapsed`를 넘기면 그쪽이 들고(목록이 다시 마운트돼도 유지),
 * 아니면 `defaultCollapsed`로 시작해 안에서 든다.
 */
export function GroupPostSection({
  title,
  info,
  defaultCollapsed = false,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  actions,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  /** ⓘ가 설명하는 문장. 없으면 ⓘ를 그리지 않는다. */
  info?: string;
  defaultCollapsed?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const [ownCollapsed, setOwnCollapsed] = useState(defaultCollapsed);
  const collapsed = controlledCollapsed ?? ownCollapsed;
  const setCollapsed = (next: boolean) => {
    setOwnCollapsed(next);
    onCollapsedChange?.(next);
  };
  const bodyId = useId();
  // 터치에서는 hover가 없어 탭으로도 열리게 열림 상태를 직접 든다.
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <section aria-label={title} className={cn("flex flex-col", className)}>
      <div className="flex items-center gap-1 px-4 md:px-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {info ? (
          <Tooltip open={infoOpen} onOpenChange={setInfoOpen}>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="text-muted-foreground"
                  aria-label={`${title} 안내`}
                  onClick={() => setInfoOpen((open) => !open)}
                />
              }
            >
              <InfoIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              {info}
            </TooltipContent>
          </Tooltip>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {collapsed ? null : actions}
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground"
            aria-label={`${title} ${collapsed ? "펼치기" : "접기"}`}
            aria-expanded={!collapsed}
            aria-controls={collapsed ? undefined : bodyId}
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronUpIcon
              className={cn(
                "size-4 transition-transform",
                collapsed && "rotate-180",
              )}
            />
          </Button>
        </div>
      </div>
      {collapsed ? null : (
        <div id={bodyId} className={bodyClassName}>
          {children}
        </div>
      )}
    </section>
  );
}

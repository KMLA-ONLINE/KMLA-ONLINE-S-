import { ChevronUpIcon, InfoIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { useGroupSectionCollapsed } from "~/features/posts/hooks/use-group-section-collapsed";
import type { GroupPostSection as SectionKind } from "~/features/posts/model/section-collapse";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/shared/ui/tooltip";

/**
 * 그룹 게시물 탭 위의 접을 수 있는 묶음(대표·고정). 머리줄은 페이스북 그룹의
 * "대표 콘텐츠 ⓘ … ^"를 따른다. 접으면 머리줄만 남겨 최근 글이 바로 보인다.
 */
export function GroupPostSection({
  groupId,
  section,
  title,
  count,
  info,
  actions,
  className,
  bodyClassName,
  children,
}: {
  groupId: string;
  section: SectionKind;
  title: string;
  /** 머리줄에 붙는 개수. 접힌 뒤에도 몇 개가 숨어 있는지 알린다. */
  count?: number;
  /** ⓘ가 설명하는 문장. 없으면 ⓘ를 그리지 않는다. */
  info?: string;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useGroupSectionCollapsed(groupId, section);
  const bodyId = useId();
  // 터치에서는 hover가 없어 탭으로도 열리게 열림 상태를 직접 든다.
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <section aria-label={title} className={cn("flex flex-col", className)}>
      <div className="flex items-center gap-1 px-4 md:px-0">
        <h2 className="text-sm font-semibold">
          {title}
          {count !== undefined ? (
            <>
              {" "}
              <span className="font-normal text-muted-foreground">
                {count}개
              </span>
            </>
          ) : null}
        </h2>
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

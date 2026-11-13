import {
  CONVERSATION_LIST_TABS,
  type ConversationListTab,
} from "~/features/messaging/model/conversation-filter";
import { cn } from "~/shared/lib/utils";

/** 대화 목록의 `전체 · 안 읽음 · 그룹` 구분(기능 명세 §13.2). */
export function ConversationListTabs({
  value,
  onChange,
  className,
}: {
  value: ConversationListTab;
  onChange: (tab: ConversationListTab) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="채팅 구분"
      className={cn("flex items-center gap-1", className)}
    >
      {CONVERSATION_LIST_TABS.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            aria-pressed={selected}
            className={cn(
              "h-8 rounded-full px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              selected
                ? "bg-primary/10 font-semibold text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

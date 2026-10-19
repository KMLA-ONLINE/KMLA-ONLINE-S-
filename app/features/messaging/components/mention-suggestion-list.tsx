import { UsersIcon } from "lucide-react";
import { useEffect } from "react";

import type { MessageMentionSuggestion } from "~/features/messaging/model/message-mentions";
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";

/** 입력창의 `aria-activedescendant`가 가리킬 후보 ID. */
export function mentionOptionId(listId: string, index: number) {
  return `${listId}-${index}`;
}

/**
 * 작성창 바로 위에 뜨는 멘션 후보(기능 명세 §13.22). 별도 창이 아니라서 입력 포커스와 화면 키보드가 그대로 남는다. 후보를 눌러도
 * 입력창이 포커스를 잃지 않도록 누르는 순간의 기본 동작을 막는다. 고르기와 닫기는 입력창이 맡는다.
 */
export function MentionSuggestionList({
  id,
  suggestions,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  className,
}: {
  id: string;
  suggestions: MessageMentionSuggestion[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (suggestion: MessageMentionSuggestion) => void;
  className?: string;
}) {
  // 화살표로 옮긴 후보가 목록 밖에 있으면 보이게 한다.
  useEffect(() => {
    document
      .getElementById(mentionOptionId(id, activeIndex))
      ?.scrollIntoView({ block: "nearest" });
  }, [id, activeIndex]);

  return (
    <ul
      id={id}
      role="listbox"
      aria-label="멘션할 사람"
      className={cn(
        "max-h-60 overflow-y-auto overscroll-contain rounded-2xl border bg-popover p-1 text-popover-foreground shadow-md",
        className,
      )}
    >
      {suggestions.map((suggestion, index) => (
        // 후보는 포커스를 받지 않는다. 키보드는 입력창이 `aria-activedescendant`로 맡는다.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events
        <li
          key={suggestion.key}
          id={mentionOptionId(id, index)}
          role="option"
          aria-selected={index === activeIndex}
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm",
            index === activeIndex && "bg-accent text-accent-foreground",
          )}
          onMouseDown={(event) => event.preventDefault()}
          onPointerMove={() => onActiveIndexChange(index)}
          onClick={() => onSelect(suggestion)}
        >
          {suggestion.target ? (
            <UserAvatar
              src={suggestion.avatarUrl}
              name={suggestion.name}
              size="sm"
            />
          ) : (
            <span
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
            >
              <UsersIcon className="size-3.5" />
            </span>
          )}
          <span className="min-w-0 truncate font-medium">
            {suggestion.name}
          </span>
        </li>
      ))}
    </ul>
  );
}

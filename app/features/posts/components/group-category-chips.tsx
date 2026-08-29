import type { GroupCategory } from "~/features/posts/model/types";
import { cn } from "~/shared/lib/utils";

function chipClass(active: boolean): string {
  return cn(
    "shrink-0 rounded-full border px-3 py-1 text-sm font-medium transition-colors",
    active
      ? "border-foreground bg-foreground text-background"
      : "border-transparent text-muted-foreground hover:bg-muted",
  );
}

export function GroupCategoryChips({
  categories,
  selected,
  onSelect,
}: {
  categories: GroupCategory[];
  selected: string | null;
  onSelect: (categoryId: string | null) => void;
}) {
  if (categories.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="카테고리"
      className="no-scrollbar flex gap-2 overflow-x-auto px-4 pt-3 md:px-0 md:pt-0"
    >
      <button
        type="button"
        aria-pressed={selected === null}
        onClick={() => onSelect(null)}
        className={chipClass(selected === null)}
      >
        전체
      </button>
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          aria-pressed={selected === category.id}
          onClick={() => onSelect(category.id)}
          className={chipClass(selected === category.id)}
        >
          {category.name}
        </button>
      ))}
    </div>
  );
}

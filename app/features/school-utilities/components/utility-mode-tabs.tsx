import { Link } from "react-router";

import type { UtilityMode } from "../data/reservations";
import { cn } from "~/shared/lib/utils";

const MODES = [
  { id: "gongang", label: "공강", to: "/menu/gongang" },
  { id: "karaoke", label: "노래방", to: "/menu/karaoke" },
] as const;

export function UtilityModeTabs({ mode }: { mode: UtilityMode }) {
  return (
    <nav aria-label="공강 및 노래방" className="flex border-b">
      {MODES.map((item) => {
        const active = item.id === mode;

        return (
          <Link
            key={item.id}
            to={item.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 flex-1 items-center justify-center border-b-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

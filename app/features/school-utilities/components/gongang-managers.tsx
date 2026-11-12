import type { GongangManager } from "../data/gongang-schedule";
import { cn } from "~/shared/lib/utils";

export function GongangManagers({
  managers,
  className,
}: {
  managers: GongangManager[];
  className?: string;
}) {
  if (!managers.length) return null;

  return (
    <p className={cn("px-1 text-sm text-muted-foreground", className)}>
      <span className="font-medium text-foreground">공강관리자:</span>{" "}
      {managers.map((manager) => manager.label).join(", ")}
    </p>
  );
}

import type { UtilityMode } from "../data/reservations";
import { cn } from "~/shared/lib/utils";

/**
 * 예약 화면에 안내하는 담당자 이름. DB의 공강 관리 권한(선예약)과는 별개로,
 * 담당자가 바뀌면 이 배열을 직접 고쳐 배포한다. 비어 있으면 줄을 숨긴다.
 */
const UTILITY_MANAGERS: Record<UtilityMode, readonly string[]> = {
  gongang: ["30기 최진명"],
  karaoke: [],
};

const LABELS: Record<UtilityMode, string> = {
  gongang: "공강관리자",
  karaoke: "노래방관리자",
};

export function UtilityManagers({
  mode,
  className,
}: {
  mode: UtilityMode;
  className?: string;
}) {
  const names = UTILITY_MANAGERS[mode];
  if (!names.length) return null;

  return (
    <p className={cn("px-1 text-sm text-muted-foreground", className)}>
      <span className="font-medium text-foreground">{LABELS[mode]}:</span>{" "}
      {names.join(", ")}
    </p>
  );
}

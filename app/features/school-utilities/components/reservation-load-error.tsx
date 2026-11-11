import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";

export function ReservationLoadError({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-center justify-between gap-2 text-sm text-destructive",
        className,
      )}
    >
      <p>{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  );
}

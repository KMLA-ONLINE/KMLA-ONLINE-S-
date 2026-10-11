import { cn } from "~/shared/lib/utils";
import { Loader2Icon } from "lucide-react";

/**
 * 버튼 안에서 글자 옆에 붙는 스피너(`data-icon`)와 `aria-hidden`을 준 스피너는 장식이다. 진행 상태는
 * 버튼 글자·`aria-busy`가 알리므로 낭독기에 "불러오는 중"을 한 번 더 읽히지 않는다.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const decorative =
    props["aria-hidden"] === true ||
    props["aria-hidden"] === "true" ||
    "data-icon" in props;

  return (
    <Loader2Icon
      data-slot="spinner"
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "status", "aria-label": "불러오는 중" })}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };

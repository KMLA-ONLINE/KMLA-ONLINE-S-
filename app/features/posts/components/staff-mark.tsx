import { cn } from "~/shared/lib/utils";

/**
 * 운영진 명의 표시(`docs/functional-spec/posts.md` §8.6). lucide `CircleCheck`은 `fill`을 주면 테마마다 모양이 달라 직접 그린 채운 체크다.
 * 글자가 없으므로 뜻은 접근성 이름이 진다.
 */
export function StaffMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label="운영진 명의"
      className={cn("size-4 shrink-0", className)}
    >
      <circle cx="12" cy="12" r="11" className="fill-primary" />
      <path
        d="m8 12.5 2.5 2.5 5.5-5.5"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-white"
      />
    </svg>
  );
}

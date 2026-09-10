import { cn } from "~/shared/lib/utils";

/**
 * 운영진 명의 표시(`docs/functional-spec/posts.md` §8.6).
 *
 * 이름 옆의 파란 체크다. 예전에는 `운영진` 글자 배지였는데, 이름 옆에 글자가 하나 더
 * 붙으면 줄이 길어지고 카테고리·`작성자` 같은 다른 표시와 섞여 오히려 안 읽혔다.
 *
 * lucide의 `CircleCheck`을 쓰지 않는다. 그쪽은 선으로 그린 아이콘이라 `fill`을 주면 원의
 * 테두리까지 `currentColor`로 남아, 라이트에서는 안 보이고 다크에서는 흰 후광이 생긴다 —
 * 테마마다 모양이 달라진다. 채워진 체크는 lucide에 없으므로 여기서 직접 그린다.
 *
 * 체크는 두 테마 모두 흰색이다. `--background`를 쓰면 다크에서 어두운 체크가 되는데,
 * 파란 원 위에서는 흰색이 어느 테마에서든 대비가 가장 크다.
 *
 * 글자가 사라졌으므로 뜻은 접근성 이름이 진다. 아이콘만 남기고 이름까지 빼면 화면 낭독기
 * 사용자에게는 표시 자체가 없는 것과 같다.
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

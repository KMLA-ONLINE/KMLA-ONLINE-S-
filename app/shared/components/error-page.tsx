import { RotateCwIcon } from "lucide-react";
import { Link } from "react-router";

import { Button } from "~/shared/ui/button";

interface ErrorPageProps {
  /** HTTP 상태. 라우트 에러 응답일 때만 있다. */
  status?: number;
  /** 개발 빌드에서만 채운다. 프로덕션 번들에 스택을 노출하지 않기 위함이다. */
  stack?: string;
  onRetry?: () => void;
}

const MESSAGES: Record<number, { title: string; detail: string }> = {
  404: {
    title: "페이지를 찾을 수 없습니다",
    detail: "주소가 바뀌었거나 삭제된 화면입니다.",
  },
  403: {
    title: "권한이 없습니다",
    detail: "이 화면을 볼 수 있는 계정으로 로그인했는지 확인해 주세요.",
  },
};

const FALLBACK = {
  title: "문제가 발생했습니다",
  detail: "잠시 후 다시 시도해 주세요.",
};

/**
 * `root.tsx`의 `ErrorBoundary`가 그리는 화면.
 *
 * 셸 바깥에서도 렌더되므로(셸 로더가 던진 에러는 셸을 그리기 전에 여기로 온다) 셸 데이터나
 * 스크롤 컨텍스트에 의존하지 않는다.
 */
export function ErrorPage({ status, stack, onRetry }: ErrorPageProps) {
  const { title, detail } = (status ? MESSAGES[status] : undefined) ?? FALLBACK;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      {status ? (
        <p className="text-6xl font-semibold text-muted-foreground tabular-nums">
          {status}
        </p>
      ) : null}

      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>

      <div className="flex items-center gap-2">
        {onRetry ? (
          <Button onClick={onRetry} variant="outline">
            <RotateCwIcon />
            다시 시도
          </Button>
        ) : null}
        <Button render={<Link to="/" />}>홈으로</Button>
      </div>

      {stack ? (
        <pre className="mt-4 max-h-64 w-full max-w-2xl overflow-auto rounded-md bg-muted p-4 text-left text-xs">
          <code>{stack}</code>
        </pre>
      ) : null}
    </main>
  );
}

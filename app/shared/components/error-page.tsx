import {
  FileQuestionMarkIcon,
  LockKeyholeIcon,
  RotateCcwIcon,
  ServerCrashIcon,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";

import { Button } from "~/shared/ui/button";

interface ErrorPageProps {
  /** HTTP 상태. 라우트 에러 응답일 때만 있다. */
  status?: number;
  /** 개발 빌드에서만 채운다. 프로덕션 번들에 스택을 노출하지 않기 위함이다. */
  stack?: string;
  onRetry?: () => void;
}

interface ErrorMessage {
  /** 제목 위에 놓는 짧은 분류. */
  code: string;
  title: string;
  detail: string;
  Icon: LucideIcon;
}

const MESSAGES: Record<number, ErrorMessage> = {
  404: {
    code: "404 · 소재 불명",
    title: "찾으시는 페이지가 결석했어요.",
    detail: "주소가 바뀌었거나, 페이지가 사라졌을 수 있어요.",
    Icon: FileQuestionMarkIcon,
  },
  403: {
    code: "403 · 출입 제한",
    title: "이 구역은 관계자 외 출입 금지에요.",
    detail: "이 페이지를 보려면 더 높은 권한이 필요해요.",
    Icon: LockKeyholeIcon,
  },
};

const FALLBACK: ErrorMessage = {
  code: "알 수 없는 오류",
  title: "서버가 잠깐 멍 때리는 중이에요.",
  detail: "새로고침하면 정신을 차릴지도 몰라요.",
  Icon: ServerCrashIcon,
};

/**
 * `root.tsx`의 `ErrorBoundary`가 그리는 화면.
 *
 * 셸 바깥에서도 렌더되므로(셸 로더가 던진 에러는 셸을 그리기 전에 여기로 온다) 셸 데이터나
 * 스크롤 컨텍스트에 의존하지 않는다.
 */
export function ErrorPage({ status, stack, onRetry }: ErrorPageProps) {
  const { code, title, detail, Icon } =
    (status ? MESSAGES[status] : undefined) ?? FALLBACK;

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div className="absolute -top-24 -left-24 size-72 rounded-full bg-primary/6 blur-3xl" />
      <div className="absolute -right-28 -bottom-28 size-80 rounded-full bg-muted blur-3xl" />

      <section className="relative w-full max-w-md text-center">
        <div className="relative mx-auto mb-7 h-40 w-52" aria-hidden="true">
          <div className="absolute inset-x-3 top-5 h-28 rotate-[-5deg] rounded-xl border border-border bg-card shadow-sm" />
          <div className="absolute inset-x-3 top-5 flex h-28 rotate-3 flex-col items-center justify-center rounded-xl border border-border bg-card shadow-sm">
            <Icon className="mb-2 size-8 text-primary" strokeWidth={1.7} />
            <span className="text-xs font-medium tracking-[0.18em] text-muted-foreground tabular-nums">
              {status ?? "ERROR"}
            </span>
          </div>
        </div>

        <p className="mb-3 text-sm font-semibold text-primary">{code}</p>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
          {detail}
        </p>

        <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
          <Button size="lg" nativeButton={false} render={<Link to="/" />}>
            홈으로 돌아가기
          </Button>
          {onRetry ? (
            <Button size="lg" variant="outline" onClick={onRetry}>
              <RotateCcwIcon />
              다시 시도
            </Button>
          ) : null}
        </div>

        {stack ? (
          <pre className="mt-8 max-h-40 overflow-auto rounded-lg bg-muted/60 p-3 text-left text-xs whitespace-pre-wrap text-muted-foreground">
            <code>{stack}</code>
          </pre>
        ) : null}
      </section>
    </main>
  );
}

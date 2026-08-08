import type { ReactNode } from "react";

/**
 * 셸 **바깥** 화면의 껍데기.
 *
 * 로그인·가입·승인 대기는 인증 게이트를 통과하기 전이라 셸 데이터(`useAppShell()`)를 쓸 수 없다.
 * 헤더도 사이드바도 탭바도 없는 게 정상이므로 여기서 자체 배치를 갖는다.
 */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">{title}</h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {children}
      </div>
    </main>
  );
}

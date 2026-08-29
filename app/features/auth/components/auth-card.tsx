import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/shared/ui/card";
import { cn } from "~/shared/lib/utils";

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
  footer,
  wide = false,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="min-h-dvh bg-muted/40 p-4 sm:p-6">
      <div className="mx-auto grid min-h-[calc(100dvh-2rem)] max-w-5xl overflow-hidden rounded-3xl bg-background shadow-sm ring-1 ring-foreground/10 sm:min-h-[calc(100dvh-3rem)] md:grid-cols-[0.9fr_1.1fr]">
        <section className="relative hidden overflow-hidden bg-primary p-10 text-primary-foreground md:flex md:flex-col md:justify-between">
          <div className="absolute -top-28 -right-24 size-72 rounded-full bg-primary-foreground/10" />
          <div className="absolute -bottom-40 -left-20 size-96 rounded-full border border-primary-foreground/15" />
          <div className="relative flex items-center gap-3">
            <img src="/logo-notext.svg" alt="" className="size-10 rounded-xl" />
            <span className="font-semibold tracking-wide">KMLA Online</span>
          </div>
          <div className="relative max-w-sm">
            <p className="text-3xl leading-tight font-semibold text-balance">
              KMLA Online
            </p>
            <p className="mt-4 text-sm leading-6 text-primary-foreground/75">
              민족사관고등학교 커뮤니티
            </p>
          </div>
          <p className="relative text-xs text-primary-foreground/60">
            Korean Minjok Leadership Academy
          </p>
        </section>

        <div className="flex items-center justify-center px-4 py-8 sm:px-10">
          <Card
            className={cn(
              "w-full border-0 shadow-none ring-0",
              wide ? "max-w-2xl" : "max-w-md",
            )}
          >
            <CardHeader className="text-center sm:text-left">
              <div className="mb-3 flex items-center justify-center gap-2 md:hidden">
                <span className="font-semibold">KMLA Online</span>
              </div>
              <CardTitle>
                <h1 className="text-2xl font-semibold">{title}</h1>
              </CardTitle>
              {description ? (
                <CardDescription className="leading-6">
                  {description}
                </CardDescription>
              ) : null}
            </CardHeader>
            {children ? <CardContent>{children}</CardContent> : null}
            {footer ? (
              <CardFooter className="justify-center text-sm text-muted-foreground">
                {footer}
              </CardFooter>
            ) : null}
          </Card>
        </div>
      </div>
    </main>
  );
}

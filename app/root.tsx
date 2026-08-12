import { ThemeProvider } from "next-themes";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import { ErrorPage } from "~/shared/components/error-page";
import { PwaPrompts } from "~/shared/components/pwa-prompts";
import { Toaster } from "~/shared/ui/sonner";
import { TooltipProvider } from "~/shared/ui/tooltip";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
  { rel: "icon", href: "/logo.svg", sizes: "any", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon-180x180.png" },
];

/**
 * `Layout` is rendered at build time to produce build/client/index.html, so it
 * must stay SSR-safe: no `window`, `document` or `localStorage` here.
 */
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes가 하이드레이션 전에 <html>의 class를 바꾸므로 서버 마크업과 어긋나는 게 정상이다.
    <html lang="ko" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="theme-color" content="#0f172a" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <Meta />
        <Links />
      </head>
      {/* overscroll-none: 셸이 h-dvh라 body는 스크롤하지 않는다. 그래도 남는 고무줄
          바운스(특히 iOS)를 여기서 끊는다. */}
      <body className="overscroll-none">
        {/* app.css의 dark 변형이 `.dark` 클래스 기준이라(@custom-variant dark (&:is(.dark *)))
            attribute는 class여야 한다. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          disableTransitionOnChange
        >
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <>
      <Outlet />
      <PwaPrompts />
    </>
  );
}

/**
 * 셸의 `clientLoader`가 도는 동안(세션 확인 + 프로필 + 뱃지) 보이는 화면.
 *
 * SPA 모드에서는 **root 라우트에서만** `HydrateFallback`을 export 할 수 있다 — 다른 라우트에
 * 두면 빌드가 `SPA Mode: Invalid HydrateFallback export`로 끊긴다. 그래서 셸 골격을 여기에 둔다.
 *
 * 스피너가 아니라 골격을 그리는 이유: 첫 페인트에서 화면 구조가 자리를 잡고 있으면 데이터가
 * 도착할 때 레이아웃이 튀지 않는다. 어차피 정적으로 프리렌더되는 유일한 부분이기도 하다.
 */
export function HydrateFallback() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <div className="h-[var(--app-header-h)] shrink-0 border-b max-md:hidden" />
      <div className="flex min-h-0 flex-1">
        <div className="w-[var(--app-rail-w)] shrink-0 border-r max-md:hidden" />
        <div className="min-h-0 flex-1" />
      </div>
      <div className="h-[calc(var(--app-tabbar-h)+var(--app-safe-b))] shrink-0 border-t md:hidden" />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let status: number | undefined;
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    status = error.status;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    stack = error.stack;
  }

  return (
    <ErrorPage
      status={status}
      stack={stack}
      onRetry={() => window.location.reload()}
    />
  );
}

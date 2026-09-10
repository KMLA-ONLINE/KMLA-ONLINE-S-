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
import { QueryProvider } from "~/shared/components/query-provider";
import { ThemeColor } from "~/shared/components/theme-color";
import { env } from "~/shared/lib/env";
import { Toaster } from "~/shared/ui/sonner";
import { TooltipProvider } from "~/shared/ui/tooltip";
import "./app.css";

const SITE_NAME = "KMLA Online";
const SITE_DESCRIPTION =
  "민족사관고등학교 구성원을 위한 온라인 커뮤니티. 공지와 그룹 게시판, 급식과 시간표를 한곳에서 봅니다.";
const OG_IMAGE = "/og-image.png";

/**
 * 문서 제목과 링크 미리보기 카드.
 *
 * SSR이 없으므로 여기서 나온 값이 곧 `build/client/index.html`이고, 크롤러가 보는 것도
 * 그 한 장뿐이다. 게시물별 카드는 만들 수 없다 — 크롤러는 JavaScript를 실행하지 않아
 * 어떤 경로로 들어와도 이 사이트 공통 카드를 읽는다. 그래도 제목·설명·이미지가 있는
 * 카드와 아무것도 없는 회색 카드는 다르고, 카카오톡으로 링크가 도는 서비스에서는 그
 * 차이가 제일 먼저 보인다.
 *
 * 자식 라우트가 `meta`를 export하면 이 값을 덮는다.
 */
export const meta: Route.MetaFunction = () => {
  // 절대 URL을 만들 수 없으면 상대 경로로 둔다. 대부분의 크롤러는 문서 URL 기준으로
  // 풀어내고, 못 푸는 쪽에서만 이미지가 빠진다 — 제목과 설명은 그대로 나간다.
  const image = env.siteUrl ? `${env.siteUrl}${OG_IMAGE}` : OG_IMAGE;

  return [
    { title: SITE_NAME },
    { name: "description", content: SITE_DESCRIPTION },
    { name: "application-name", content: SITE_NAME },
    // iOS 홈 화면 아이콘 아래 이름. 없으면 manifest의 `short_name`으로 넘어가지만,
    // Safari 버전에 따라 문서 제목을 그대로 쓰는 경로가 남아 있다.
    { name: "apple-mobile-web-app-title", content: SITE_NAME },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: SITE_NAME },
    { property: "og:description", content: SITE_DESCRIPTION },
    { property: "og:locale", content: "ko_KR" },
    { property: "og:image", content: image },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: `${SITE_NAME} 로고` },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: SITE_NAME },
    { name: "twitter:description", content: SITE_DESCRIPTION },
    { name: "twitter:image", content: image },
  ];
};

export const links: Route.LinksFunction = () => [
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
  // 탭 아이콘은 16-32px로 그려진다. 글자 있는 logo.svg를 쓰면 "KMLA"가 뭉개지므로
  // 글자 없는 마크를 쓴다 — 같은 이유로 favicon.ico도 글자 없는 버전이다.
  {
    rel: "icon",
    href: "/logo-notext.svg",
    sizes: "any",
    type: "image/svg+xml",
  },
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
        {/* 하이드레이션 전 기본값. `ThemeProvider`의 `defaultTheme`과 같은 라이트 배경이며,
            테마가 정해진 뒤에는 `<ThemeColor />`가 실제 배경색으로 덮어쓴다. */}
        <meta name="theme-color" content="#ffffff" />
        <meta name="mobile-web-app-capable" content="yes" />
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
          <ThemeColor />
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
    <QueryProvider>
      <Outlet />
      <PwaPrompts />
    </QueryProvider>
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

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
import {
  SplashTyping,
  SplashTypingScript,
  waitForSplashEgg,
} from "~/shared/components/splash-typing";
import { Spinner } from "~/shared/ui/spinner";
import { PwaPrompts } from "~/shared/components/pwa-prompts";
import { QueryProvider } from "~/shared/components/query-provider";
import {
  ThemeColorMeta,
  ThemeColorSync,
} from "~/shared/components/theme-color-meta";
import { ViewportMeta } from "~/shared/components/viewport-meta";
import { env } from "~/shared/lib/env";
import { cn } from "~/shared/lib/utils";
import { isNetworkError } from "~/shared/lib/network-error";
import { useOffline } from "~/shared/hooks/use-offline";
import { ImageViewerProvider } from "~/shared/hooks/use-image-viewer-param";
import { Toaster } from "~/shared/ui/sonner";
import { TooltipProvider } from "~/shared/ui/tooltip";
import "./app.css";

const SITE_NAME = "KMLA Online";
const SITE_DESCRIPTION = "민족사관고등학교 학생 커뮤니티";
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
        <ViewportMeta />
        <SplashTypingScript />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <ThemeColorMeta />
        <Meta />
        <Links />
      </head>
      {/* 셸이 h-dvh라 body는 스크롤하지 않지만, iOS 고무줄 바운스는 overscroll-none으로 끊는다. */}
      <body className="overscroll-none">
        {/* app.css의 dark 변형이 `.dark` 클래스 기준이라 attribute는 class여야 한다. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          disableTransitionOnChange
        >
          <ThemeColorSync />
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

/**
 * 첫 로딩에만 돈다. 자식 라우트의 로더와 함께 기다리므로, 이스터에그 문구가 다 쳐질 때까지
 * {@link HydrateFallback}이 남는다. 데이터가 없으니 화면 이동 때마다 다시 돌 이유가 없다.
 */
export async function clientLoader() {
  await waitForSplashEgg();
  return null;
}
clientLoader.hydrate = true as const;

// 루트 로더가 데이터를 돌려주게 되면 이 값도 다시 정해야 한다.
export function shouldRevalidate() {
  return false;
}

export default function App() {
  return (
    <QueryProvider>
      <ImageViewerProvider>
        <Outlet />
        <PwaPrompts />
      </ImageViewerProvider>
    </QueryProvider>
  );
}

/**
 * 셸의 `clientLoader`가 도는 동안(세션 확인 + 프로필 + 뱃지) 보이는 화면.
 *
 * SPA 모드에서는 **root 라우트에서만** `HydrateFallback`을 export 할 수 있다 — 다른 라우트에
 * 두면 빌드가 `SPA Mode: Invalid HydrateFallback export`로 끊긴다. 그래서 로딩 화면을 여기에 둔다.
 *
 * 브라우저에서는 빈 화면 가운데에 글자가 쳐지는 {@link SplashTyping}을 그린다. 예전에는 셸
 * 골격(헤더·사이드바 테두리)을 그렸는데, 내용 없이 선만 먼저 그려졌다 채워지는 게 오히려
 * 덜 된 화면처럼 보여서 걷어냈다.
 *
 * 설치된 PWA에서는 글자 대신 로고를 그린다. OS 스플래시는 첫 페인트에 걷히므로, 그 자리에
 * 같은 로고를 이어 그려야 JS를 받는 동안 다른 화면이 끼지 않는다. 일부러 붙잡지는 않는다 —
 * 앱이 준비되는 순간 사라지고, 길어질 때만 스피너가 늦게 나타나 멈춘 화면처럼 보이지 않게 한다.
 */
export function HydrateFallback() {
  return (
    <>
      {/* 로고는 OS 스플래시처럼 정중앙에 둔다. 스피너가 흐름에 끼면 로고가 위로 밀려 넘어갈 때 튄다. */}
      <div className="hidden h-dvh items-center justify-center bg-background [@media(display-mode:standalone)]:flex">
        <div className="relative">
          <img
            src="/logo.svg"
            alt="KMLA Online"
            width={112}
            height={112}
            fetchPriority="high"
            className="size-28"
          />
          <span className="absolute top-full left-1/2 mt-8 flex -translate-x-1/2 flex-col items-center gap-4">
            {/* `animate-spin`과 한 요소에 두면 `animation`을 서로 덮어쓰므로 감싸서 건다. */}
            <span className="animate-splash-hint">
              <Spinner className="size-5 text-muted-foreground motion-reduce:animate-none" />
            </span>
            <SplashConnectionHint />
          </span>
        </div>
      </div>
      <div className="flex h-dvh items-center justify-center bg-background [@media(display-mode:standalone)]:hidden">
        <SplashTyping />
      </div>
    </>
  );
}

/**
 * 로고 화면이 길어질 때 원인을 짐작하게 하는 한 줄. 느린 연결은 시간으로만 알 수 있어서
 * 8초 뒤에 CSS로 띄운다 — JS를 받는 중에도 보이고, 프리렌더에서 `window`를 건드리지 않는다.
 *
 * 브라우저가 끊김을 알려 주면 기다리지 않고 바로 바꿔 말한다. 그동안 셸 로더의 쿼리는
 * React Query가 멈춰 두었다가 연결이 돌아오면 알아서 이어 간다.
 */
function SplashConnectionHint() {
  const offline = useOffline();

  return (
    // `role="status"`를 주지 않는다. 투명한 동안에도 접근성 트리에 있어서 8초를 기다리지 않고
    // 곧바로 읽힌다. 기다리는 중이라는 사실은 스피너가 이미 알린다.
    <p
      className={cn(
        "text-sm whitespace-nowrap text-muted-foreground",
        !offline && "animate-splash-slow",
      )}
    >
      {offline
        ? "인터넷에 연결되어 있지 않아요."
        : "Wi-Fi나 데이터 연결을 확인해 주세요."}
    </p>
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
      network={!isRouteErrorResponse(error) && isNetworkError(error)}
      onRetry={() => window.location.reload()}
    />
  );
}

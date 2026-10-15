import { useTheme } from "next-themes";
import { useEffect } from "react";

// app.css의 `--background`(라이트 oklch(1 0 0), 다크 oklch(0.22 0.006 264))를 hex로 옮긴 값.
// Android는 이 색의 밝기로 상태바 아이콘 색을 정한다. 값이 없으면 OS 다크 모드를 따라가
// 라이트 앱 위에 흰 아이콘이 그려진다.
const THEME_COLORS = { light: "#ffffff", dark: "#191b1d" } as const;

/**
 * 정적 문서에는 라이트 값을 두고, 하이드레이션 뒤 앱 테마로 맞춘다. `media` 분기는
 * 앱 설정이 아니라 OS 설정을 따르므로 쓰지 않는다.
 */
export function ThemeColorMeta() {
  return <meta name="theme-color" content={THEME_COLORS.light} />;
}

export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        resolvedTheme === "dark" ? THEME_COLORS.dark : THEME_COLORS.light,
      );
  }, [resolvedTheme]);

  return null;
}

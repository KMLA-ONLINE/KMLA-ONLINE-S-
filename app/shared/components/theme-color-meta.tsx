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
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    const dark = resolvedTheme === "dark";
    // 갤럭시 Chrome 설치 앱은 값이 바뀔 때만 아이콘 대비를 다시 계산했다. 정적 값과 같은
    // 라이트로 켜면 흰 아이콘이 남으므로, 반대 색을 거쳐 변화로 인식시킨다.
    meta.setAttribute("content", dark ? THEME_COLORS.light : THEME_COLORS.dark);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() =>
        meta.setAttribute(
          "content",
          dark ? THEME_COLORS.dark : THEME_COLORS.light,
        ),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [resolvedTheme]);

  return null;
}

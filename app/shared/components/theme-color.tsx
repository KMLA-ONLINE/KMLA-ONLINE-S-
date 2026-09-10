import { useTheme } from "next-themes";
import { useEffect } from "react";

/**
 * 브라우저 UI 색(`<meta name="theme-color">`)을 지금 그려진 배경색에 맞춘다.
 *
 * 설치형 PWA에서는 이 색이 상태바 영역이고, 브라우저 탭에서는 주소창 주변이다. 값이
 * 하나로 고정돼 있으면 둘 중 한 테마에서 반드시 어긋난다 — 흰 화면 위에 네이비 띠가
 * 붙거나 그 반대가 된다.
 *
 * `prefers-color-scheme` 미디어 쿼리로 태그를 두 개 두는 방법을 쓰지 않는 이유는, 이 앱의
 * 테마가 OS 설정이 아니라 `next-themes`의 클래스이기 때문이다. OS가 다크인데 앱을 라이트로
 * 고정해 둔 사용자에게는 미디어 쿼리가 정반대 색을 고른다.
 *
 * 색을 상수로 적어 두지 않고 `body`에서 읽는 것도 같은 이유다. `--background`가 바뀌면
 * 따라오고, `oklch()`를 브라우저가 이미 `rgb()`로 계산해 둔 값을 그대로 쓰므로 오래된
 * 파서가 있는 곳에서도 안전하다.
 */
export function ThemeColor() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;

    // 클래스 교체와 같은 프레임에 읽으면 이전 테마 값이 나온다. 다음 프레임에서 읽는다.
    const frame = requestAnimationFrame(() => {
      const background = getComputedStyle(document.body).backgroundColor;
      // 스타일시트가 아직 안 붙었으면 빈 문자열이나 투명이 나온다(`transparent`는 계산
      // 값에서 `rgba(0, 0, 0, 0)`이다). 그때는 손대지 않고 하이드레이션 전 기본값을
      // 그대로 둔다 — 투명을 그대로 쓰면 브라우저가 색을 잃는다.
      if (!background || /,\s*0\)$/.test(background)) return;
      meta.setAttribute("content", background);
    });

    return () => cancelAnimationFrame(frame);
  }, [resolvedTheme]);

  return null;
}

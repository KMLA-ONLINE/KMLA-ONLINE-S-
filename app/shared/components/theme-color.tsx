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
/**
 * 알파가 0인 색인지 본다. 알파 채널이 없는 표기(`rgb(r, g, b)`)는 불투명이다.
 *
 * 문자열 끝을 보고 판정하면 안 된다 — `rgb(0, 0, 0)`처럼 마지막 채널이 0인 불투명 색이
 * 투명으로 잡힌다. 그러면 순수 검정 배경에서 theme-color가 하이드레이션 전 기본값에
 * 묶인 채로 남는다.
 *
 * 계산 값은 브라우저마다 `rgba(r, g, b, a)`와 `rgb(r g b / a)` 두 표기가 모두 나온다.
 */
export function isTransparent(color: string): boolean {
  const value = color.trim();
  // 계산 값은 키워드로 돌아오지 않지만, 돌아온다면 그대로 쓸 수 없는 값이다.
  if (value === "transparent") return true;

  const parsed = /^rgba?\(([^)]*)\)$/.exec(value);
  if (!parsed) return false;

  const [channels, slashAlpha] = parsed[1].split("/");
  if (slashAlpha !== undefined) return Number.parseFloat(slashAlpha) === 0;

  const parts = channels.split(",");
  return parts.length === 4 && Number.parseFloat(parts[3]) === 0;
}

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
      if (!background || isTransparent(background)) return;
      meta.setAttribute("content", background);
    });

    return () => cancelAnimationFrame(frame);
  }, [resolvedTheme]);

  return null;
}

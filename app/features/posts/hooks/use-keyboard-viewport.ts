import { useEffect, useState } from "react";

const DESKTOP_QUERY = "(min-width: 768px)";
const MIN_KEYBOARD_INSET = 60;

export interface KeyboardViewport {
  bottomInset: number;
  height: number | null;
}

const DEFAULT_VIEWPORT: KeyboardViewport = {
  bottomInset: 0,
  height: null,
};

/** 모바일 댓글 시트를 현재 visual viewport 안에 가둔다. */
export function useKeyboardViewport(enabled: boolean): KeyboardViewport {
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);

  useEffect(() => {
    if (!enabled) return;

    const desktop = window.matchMedia(DESKTOP_QUERY);
    const visualViewport = window.visualViewport;

    const measure = () => {
      if (desktop.matches || visualViewport?.scale !== 1) {
        setViewport(DEFAULT_VIEWPORT);
        return;
      }

      const hiddenBottom = Math.max(
        0,
        window.innerHeight - (visualViewport.offsetTop + visualViewport.height),
      );
      const next = {
        bottomInset: hiddenBottom >= MIN_KEYBOARD_INSET ? hiddenBottom : 0,
        height: visualViewport.height,
      };

      setViewport((current) =>
        current.bottomInset === next.bottomInset &&
        current.height === next.height
          ? current
          : next,
      );
    };

    measure();
    desktop.addEventListener("change", measure);
    visualViewport?.addEventListener("resize", measure);
    visualViewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);

    return () => {
      desktop.removeEventListener("change", measure);
      visualViewport?.removeEventListener("resize", measure);
      visualViewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [enabled]);

  return enabled ? viewport : DEFAULT_VIEWPORT;
}

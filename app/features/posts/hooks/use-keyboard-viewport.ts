import { useEffect, useState } from "react";

const MIN_KEYBOARD_INSET = 60;

export interface KeyboardViewport {
  bottomInset: number;
  height: number | null;
}

const DEFAULT_VIEWPORT: KeyboardViewport = {
  bottomInset: 0,
  height: null,
};

/** 열린 댓글 시트를 현재 visual viewport 안에 가둔다. */
export function useKeyboardViewport(enabled: boolean): KeyboardViewport {
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);

  useEffect(() => {
    if (!enabled) return;

    const visualViewport = window.visualViewport;

    const measure = () => {
      if (visualViewport?.scale !== 1) {
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
    visualViewport?.addEventListener("resize", measure);
    visualViewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);

    return () => {
      visualViewport?.removeEventListener("resize", measure);
      visualViewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [enabled]);

  return enabled ? viewport : DEFAULT_VIEWPORT;
}

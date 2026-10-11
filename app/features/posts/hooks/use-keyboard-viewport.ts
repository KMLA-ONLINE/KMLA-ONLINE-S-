import { useEffect, useState } from "react";

const MIN_KEYBOARD_INSET = 60;

export interface KeyboardViewport {
  /** 키보드가 떠 있다. 보이는 높이가 줄었는지로 본다. */
  keyboardOpen: boolean;
  /** 화면 아래에서 가려진 높이. 키보드가 떠 있어도 브라우저가 화면을 끌어올렸으면 0일 수 있다. */
  bottomInset: number;
  height: number | null;
}

const DEFAULT_VIEWPORT: KeyboardViewport = {
  keyboardOpen: false,
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

      // 가려진 아래쪽만 보면 안 된다. 안드로이드 Chrome은 키보드를 띄우며 화면을 키보드
      // 높이만큼 끌어올리므로(offsetTop) 가려진 아래쪽이 0이 된다.
      const keyboardOpen =
        window.innerHeight - visualViewport.height >= MIN_KEYBOARD_INSET;
      const hiddenBottom = Math.max(
        0,
        window.innerHeight - (visualViewport.offsetTop + visualViewport.height),
      );
      const next = {
        keyboardOpen,
        bottomInset: keyboardOpen ? hiddenBottom : 0,
        height: visualViewport.height,
      };

      setViewport((current) =>
        current.keyboardOpen === next.keyboardOpen &&
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

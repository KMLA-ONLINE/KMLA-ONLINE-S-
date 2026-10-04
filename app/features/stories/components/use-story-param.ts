import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

const PARAM = "story";
const COMPOSER_VALUE = "new";

/** 오버레이를 연 것이 우리라는 표식. 뒤로가기로 닫을 수 있는지 판단하는 근거다. */
interface StoryLocationState {
  storyOverlayPushed?: boolean;
}

export type StoryParam =
  { kind: "none" } | { kind: "composer" } | { kind: "story"; id: number };

/**
 * 스토리 뷰어와 작성 창의 열림 상태를 URL에 둔다(`?story=<id>`, `?story=new`).
 *
 * 둘 다 화면 전체를 덮어서 사용자는 습관적으로 뒤로가기로 닫는다. 열 때 history entry를 하나
 * push해 두면 뒤로가기가 그 entry만 pop한다(`useSearchDialogParam`과 같은 이유). 뷰어 안에서
 * 장을 넘기는 것은 replace라서 몇 장을 보든 뒤로가기 한 번이면 닫힌다.
 *
 * `?story=<id>`는 그대로 공유 링크이기도 하다. 링크로 들어오면 pop할 entry가 없으므로 닫을 때
 * param만 지운다.
 */
export function useStoryParam() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state as StoryLocationState | null;
  const raw = searchParams.get(PARAM);

  let param: StoryParam = { kind: "none" };

  if (raw === COMPOSER_VALUE) param = { kind: "composer" };
  else if (raw && /^\d+$/.test(raw)) param = { kind: "story", id: Number(raw) };

  const open = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams);
      next.set(PARAM, value);
      void setSearchParams(next, {
        preventScrollReset: true,
        state: { storyOverlayPushed: true } satisfies StoryLocationState,
      });
    },
    [searchParams, setSearchParams],
  );

  const showStory = useCallback(
    (id: number) => {
      const next = new URLSearchParams(searchParams);
      next.set(PARAM, String(id));
      // replace는 state를 승계하지 않으므로 표식을 그대로 넘긴다.
      void setSearchParams(next, {
        replace: true,
        preventScrollReset: true,
        state: locationState,
      });
    },
    [locationState, searchParams, setSearchParams],
  );

  const close = useCallback(() => {
    if (locationState?.storyOverlayPushed) {
      void navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete(PARAM);
    void setSearchParams(next, { replace: true, preventScrollReset: true });
  }, [locationState, navigate, searchParams, setSearchParams]);

  return {
    param,
    openComposer: useCallback(() => open(COMPOSER_VALUE), [open]),
    openStory: useCallback((id: number) => open(String(id)), [open]),
    showStory,
    close,
  };
}

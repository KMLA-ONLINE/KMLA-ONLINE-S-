import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { useLocation, useNavigation, useNavigationType } from "react-router";

import {
  resolveScrollTarget,
  type ScrollLocation,
} from "~/features/app-shell/model/scroll-memory";
import { ScrollContainerContext } from "~/shared/lib/scroll-container";
import { cn } from "~/shared/lib/utils";

// 모듈 수준에 둔다. 메신저처럼 다른 layout으로 나갔다 오면 이 컴포넌트는 다시 마운트된다.
const positionsByKey = new Map<string, number>();
const positionsByPath = new Map<string, number>();

/** 돌아온 화면이 아직 짧으면 몇 프레임 더 기다리며 다시 맞춘다. 그 이상은 쫓지 않는다. */
const MAX_RESTORE_FRAMES = 30;

/**
 * 레이아웃이 렌더하는 스크롤 영역. 셸 안에서 실제로 스크롤하는 유일한 엘리먼트다.
 *
 * 모바일 기본값은 좌우 여백 0이다. 여백이 필요한 페이지가 자기 콘텐츠에 `px-4`를 붙인다 —
 * 셸이 여백을 축 하나로 관리하지 않는다.
 *
 * 스크롤 위치 복원도 여기서 한다. window가 아니라서 React Router의 `<ScrollRestoration>`이 닿지 않는다.
 */
export function ScrollRegion({
  className,
  children,
  scrollRef,
  rememberScroll = false,
}: {
  className?: string;
  children: ReactNode;
  scrollRef?: RefObject<HTMLElement | null>;
  rememberScroll?: boolean;
}) {
  const internalRef = useRef<HTMLElement>(null);
  const ref = scrollRef ?? internalRef;
  useScrollMemory(ref, rememberScroll);

  return (
    <ScrollContainerContext value={ref}>
      <main
        ref={ref}
        // overscroll-contain: 끝에서 더 당길 때 브라우저 제스처로 전파되지 않게 한다(특히 iOS).
        // overflow-x-hidden 명시 필수: 세로만 지정하면 가로 `visible`이 `auto`로 계산돼 1px만 삐져나가도 페이지가 옆으로 끌린다.
        // relative: 위치 기준이 없는 absolute 자손(Base UI 체크박스의 숨은 input 등)이 이 영역 밖을 기준으로 잡히면 스크롤을
        // 따라오지 않고, 포커스를 받을 때 브라우저가 그걸 보이려고 셸의 overflow-hidden 컨테이너를 밀어 올린다.
        className={cn(
          "relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain md:[scrollbar-gutter:stable_both-edges]",
          className,
        )}
      >
        {children}
      </main>
    </ScrollContainerContext>
  );
}

function useScrollMemory(
  ref: RefObject<HTMLElement | null>,
  rememberScroll: boolean,
) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigation = useNavigation();
  const idle = navigation.state === "idle";
  const current = useRef({ location, rememberScroll, idle });
  useLayoutEffect(() => {
    current.current = { location, rememberScroll, idle };
  });
  const previous = useRef<ScrollLocation | null>(null);
  const restoring = useRef(false);

  // 이동 중에는 기록하지 않는다. skeleton으로 바뀌며 콘텐츠가 짧아지면 브라우저가 위치를 깎는데,
  // 그 값이 떠나는 화면의 위치로 저장되면 안 된다.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const onScroll = () => {
      const { location, rememberScroll, idle } = current.current;
      if (!idle || restoring.current) return;
      positionsByKey.set(location.key, element.scrollTop);
      if (rememberScroll)
        positionsByPath.set(location.pathname, element.scrollTop);
    };

    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, [ref]);

  // 새 화면이 그려진 직후, 페인트 전에 맞춘다.
  useLayoutEffect(() => {
    const element = ref.current;
    const next = { key: location.key, pathname: location.pathname };
    const target = resolveScrollTarget({
      previous: previous.current,
      next,
      navigationType,
      rememberByPath: rememberScroll,
      byKey: positionsByKey,
      byPath: positionsByPath,
    });
    previous.current = next;
    if (!element || target === null) return;

    element.scrollTop = target;
    if (Math.abs(element.scrollTop - target) < 1) return;

    // 아직 콘텐츠가 다 안 그려져 짧다. 그동안 브라우저가 깎은 값이 저장되지 않게 막고 몇 프레임 더 맞춘다.
    // 사용자가 먼저 스크롤하면 그 의도를 따른다.
    restoring.current = true;
    let frames = 0;
    let frameId = 0;
    const stop = () => {
      restoring.current = false;
      window.cancelAnimationFrame(frameId);
      element.removeEventListener("wheel", stop);
      element.removeEventListener("touchstart", stop);
      element.removeEventListener("keydown", stop);
    };
    const step = () => {
      element.scrollTop = target;
      frames += 1;
      if (
        Math.abs(element.scrollTop - target) < 1 ||
        frames >= MAX_RESTORE_FRAMES
      )
        stop();
      else frameId = window.requestAnimationFrame(step);
    };
    element.addEventListener("wheel", stop, { passive: true });
    element.addEventListener("touchstart", stop, { passive: true });
    element.addEventListener("keydown", stop);
    frameId = window.requestAnimationFrame(step);
    return stop;
    // 위치를 정하는 건 화면 이동뿐이다. `rememberScroll`은 같은 커밋에서 함께 바뀐다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
}

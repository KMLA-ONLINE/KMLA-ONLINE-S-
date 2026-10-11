import { useCallback, useId } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

const PARAM = "reactions";

/** 목록을 연 버튼. 뒤로가기로 닫을 수 있는지와 누가 그릴지를 함께 정한다. */
interface ReactionListLocationState {
  reactionListOwner?: string;
}

/**
 * 반응 참여자 목록의 열림 상태를 URL에 둔다(`?reactions=post:<id>`, `?reactions=comment:<id>`).
 *
 * 모바일에서는 전체화면이라 사용자는 뒤로가기로 닫는다. 열림 상태가 component state에만 있으면
 * 그 뒤로가기가 닫을 것을 찾지 못해 화면 자체를 떠난다. 열 때 history entry를 하나 push해 두면
 * 뒤로가기가 그 entry만 pop한다(`useSearchDialogParam`과 같은 이유).
 *
 * 같은 게시물의 반응 버튼이 피드 카드와 그 위에 뜬 상세에 함께 있을 수 있어서, URL만 보고
 * 열면 목록이 두 겹 뜬다. 연 버튼의 id를 entry state에 남겨 그 버튼만 목록을 그린다.
 */
export function useReactionListParam(target: string) {
  const owner = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const entryState: unknown = location.state;
  const locationState = entryState as ReactionListLocationState | null;
  const pushed = locationState?.reactionListOwner === owner;
  const open = pushed && searchParams.get(PARAM) === target;

  const show = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.set(PARAM, target);
    void setSearchParams(next, {
      preventScrollReset: true,
      // 상세가 entry state에 실어 둔 표시(그룹 링크 감춤 등)는 목록이 떠 있는 동안에도 그대로다.
      state: {
        ...(typeof entryState === "object" ? entryState : null),
        reactionListOwner: owner,
      } satisfies ReactionListLocationState,
    });
  }, [entryState, owner, searchParams, setSearchParams, target]);

  // 목록은 이 버튼이 push한 entry에서만 열리므로 닫기는 언제나 그 entry를 pop하는 것이다.
  // 주소만 들고 들어온 경우엔 연 버튼이 없어 목록 자체가 뜨지 않는다.
  const close = useCallback(() => {
    if (pushed) void navigate(-1);
  }, [navigate, pushed]);

  return { open, show, close };
}

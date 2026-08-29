import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

const OPEN_PARAM = "search";
const QUERY_PARAM = "q";

interface DirectorySearchLocationState {
  directorySearchPushed?: boolean;
}

export interface DirectorySearchDialogState {
  open: boolean;
  submittedQuery: string;
  openSearch: () => void;
  closeSearch: () => void;
  submitQuery: (query: string) => void;
}

/** `useGroupPostSearch`(app/features/posts/hooks/use-group-post-search.ts)와 같은 이유로
 * 열림 상태를 URL에 둔다: 모바일 전체화면에서 뒤로가기는 이 오버레이만 닫아야지 홈을
 * 떠나면 안 된다. */
export function useDirectorySearchDialog(): DirectorySearchDialogState {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state as DirectorySearchLocationState | null;
  const open = searchParams.get(OPEN_PARAM) === "1";
  const submittedQuery = open
    ? (searchParams.get(QUERY_PARAM)?.normalize("NFC").trim() ?? "")
    : "";

  const openSearch = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.set(OPEN_PARAM, "1");
    next.delete(QUERY_PARAM);
    void setSearchParams(next, {
      preventScrollReset: true,
      state: {
        directorySearchPushed: true,
      } satisfies DirectorySearchLocationState,
    });
  }, [searchParams, setSearchParams]);

  const closeSearch = useCallback(() => {
    if (locationState?.directorySearchPushed) {
      void navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete(OPEN_PARAM);
    next.delete(QUERY_PARAM);
    void setSearchParams(next, { replace: true, preventScrollReset: true });
  }, [locationState, navigate, searchParams, setSearchParams]);

  const submitQuery = useCallback(
    (query: string) => {
      const next = new URLSearchParams(searchParams);
      next.set(OPEN_PARAM, "1");
      if (query) next.set(QUERY_PARAM, query);
      else next.delete(QUERY_PARAM);
      void setSearchParams(next, {
        replace: true,
        preventScrollReset: true,
        state: locationState,
      });
    },
    [locationState, searchParams, setSearchParams],
  );

  return { open, submittedQuery, openSearch, closeSearch, submitQuery };
}

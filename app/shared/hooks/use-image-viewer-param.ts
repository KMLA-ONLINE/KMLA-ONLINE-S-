import { useLocation, useNavigate, useSearchParams } from "react-router";

import type { ViewerImage } from "~/shared/components/image-viewer";

/** 뷰어를 연 것이 우리라는 표식. 뒤로가기로 닫을 수 있는지 판단하는 근거다. */
interface ImageViewerLocationState {
  imageViewerPushed?: boolean;
}

/**
 * `?image=<id>`로 여는 `ImageViewer`의 열기/닫기.
 *
 * 뷰어 상태를 컴포넌트가 아니라 URL에 두는 이유는 안드로이드의 뒤로가기 제스처와 PWA의
 * 뒤로가기 때문이다 — 사진을 크게 본 사람이 뒤로가기를 누르면 화면이 아니라 사진이 닫혀야
 * 한다. 그래서 여는 쪽은 history에 entry를 쌓고, 닫는 쪽은 그 entry를 되감는다.
 *
 * `openImageId`가 목록에 있는 id만 돌려주는 것이 중요하다. 피드 한 화면에 이 훅을 쓰는
 * 컴포넌트가 여럿 있고 모두 같은 search param을 보므로, 자기 사진이 아니면 여기서 걸러지지
 * 않는 한 게시물마다 뷰어가 하나씩 열린다.
 */
export function useImageViewerParam(images: ViewerImage[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const requestedImageId = searchParams.get("image");
  const openImageId =
    requestedImageId !== null &&
    images.some((image) => image.id === requestedImageId)
      ? requestedImageId
      : null;

  const open = (imageId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("image", imageId);
    void setSearchParams(next, {
      preventScrollReset: true,
      state: { imageViewerPushed: true } satisfies ImageViewerLocationState,
    });
  };

  const close = () => {
    // 우리가 push한 entry라면 뒤로가기로 닫는 게 맞다. 링크를 직접 열어 들어온 경우엔 pop할
    // 게 없으니 param만 지운다 — 그대로 pop하면 앱 밖으로 나가 버린다.
    const state = location.state as ImageViewerLocationState | null;
    if (state?.imageViewerPushed) {
      void navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("image");
    void setSearchParams(next, { replace: true, preventScrollReset: true });
  };

  return { openImageId, open, close };
}

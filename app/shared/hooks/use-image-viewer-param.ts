import {
  createElement,
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import type { ViewerImage } from "~/shared/components/image-viewer";

// 뷰어와 제스처 코드는 이 Provider를 거쳐 root에 걸리므로, 모든 화면의 첫 로딩에서 뺀다.
const loadImageViewer = () => import("~/shared/components/image-viewer");
const ImageViewer = lazy(() =>
  loadImageViewer().then((module) => ({ default: module.ImageViewer })),
);

/** 뷰어를 연 것이 우리라는 표식. 뒤로가기로 닫을 수 있는지 판단하는 근거다. */
interface ImageViewerLocationState {
  imageViewerPushed?: boolean;
}

interface ImageViewerRegistration {
  id: string;
  images: ViewerImage[];
  downloadAll: boolean;
}

interface ImageViewerRegistry {
  register: (registration: ImageViewerRegistration) => void;
  unregister: (id: string) => void;
}

const NO_IMAGES: ViewerImage[] = [];

const ImageViewerRegistryContext = createContext<ImageViewerRegistry | null>(
  null,
);

function sameImages(left: ViewerImage[], right: ViewerImage[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (image, index) =>
        image.id === right[index]?.id &&
        image.src === right[index]?.src &&
        image.thumbSrc === right[index]?.thumbSrc &&
        image.downloadSrc === right[index]?.downloadSrc &&
        image.name === right[index]?.name &&
        image.width === right[index]?.width &&
        image.height === right[index]?.height,
    )
  );
}

/** 앱 전체에서 URL 하나를 Dialog 하나로 해석한다. */
export function ImageViewerProvider({ children }: { children: ReactNode }) {
  const [registrations, setRegistrations] = useState<ImageViewerRegistration[]>(
    [],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const register = useCallback((registration: ImageViewerRegistration) => {
    setRegistrations((current) => {
      const index = current.findIndex((item) => item.id === registration.id);
      if (index === -1) return [...current, registration];

      const existing = current[index];
      if (
        existing?.downloadAll === registration.downloadAll &&
        sameImages(existing.images, registration.images)
      ) {
        return current;
      }

      const next = current.slice();
      next[index] = registration;
      return next;
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setRegistrations((current) => {
      const index = current.findIndex((item) => item.id === id);
      return index === -1
        ? current
        : [...current.slice(0, index), ...current.slice(index + 1)];
    });
  }, []);

  // 이미지가 있는 화면이 뜨면 미리 받아 둬서, 첫 탭에서 뷰어가 늦게 뜨지 않게 한다.
  const hasRegistrations = registrations.length > 0;
  useEffect(() => {
    if (hasRegistrations) void loadImageViewer();
  }, [hasRegistrations]);

  const requestedImageId = searchParams.get("image");
  const activeRegistration = requestedImageId
    ? registrations.find((registration) =>
        registration.images.some((image) => image.id === requestedImageId),
      )
    : undefined;
  const locationState = location.state as ImageViewerLocationState | null;

  // 한 번 열린 뒤에는 계속 그린다. 닫히는 애니메이션이 마지막 묶음을 들고 끝나야 한다.
  const [viewerMounted, setViewerMounted] = useState(false);
  if (activeRegistration && !viewerMounted) setViewerMounted(true);

  const close = useCallback(() => {
    if (locationState?.imageViewerPushed) {
      void navigate(-1);
      return;
    }

    const next = new URLSearchParams(searchParams);
    next.delete("image");
    void setSearchParams(next, { replace: true, preventScrollReset: true });
  }, [
    locationState?.imageViewerPushed,
    navigate,
    searchParams,
    setSearchParams,
  ]);

  const registry = useMemo(
    () => ({ register, unregister }),
    [register, unregister],
  );

  return createElement(
    ImageViewerRegistryContext.Provider,
    { value: registry },
    children,
    viewerMounted
      ? createElement(
          Suspense,
          { fallback: null },
          createElement(ImageViewer, {
            images: activeRegistration?.images ?? NO_IMAGES,
            openImageId: activeRegistration ? requestedImageId : null,
            downloadAll: activeRegistration?.downloadAll,
            onClose: close,
          }),
        )
      : null,
  );
}

/**
 * `?image=<id>`로 여는 `ImageViewer`의 열기/닫기.
 *
 * 뷰어 상태를 컴포넌트가 아니라 URL에 두는 이유는 안드로이드의 뒤로가기 제스처와 PWA의
 * 뒤로가기 때문이다 — 사진을 크게 본 사람이 뒤로가기를 누르면 화면이 아니라 사진이 닫혀야
 * 한다. 그래서 여는 쪽은 history에 entry를 쌓고, 닫는 쪽은 그 entry를 되감는다.
 *
 * 이미지 묶음은 앱의 단일 `ImageViewerProvider`에 등록한다. 같은 사진이 카드와 상세에 동시에
 * 있어도 provider가 Dialog 하나만 렌더링하므로 history 닫기가 겹치지 않는다.
 */
export function useImageViewerParam(
  images: ViewerImage[],
  { downloadAll = false }: { downloadAll?: boolean } = {},
) {
  const registry = useContext(ImageViewerRegistryContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const registrationId = useId();

  if (!registry) {
    throw new Error(
      "useImageViewerParam must be used within ImageViewerProvider",
    );
  }

  useEffect(() => {
    registry.register({ id: registrationId, images, downloadAll });
    return () => registry.unregister(registrationId);
  }, [downloadAll, images, registrationId, registry]);

  const open = (imageId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("image", imageId);
    const locationState = location.state as unknown;
    const existingState =
      locationState !== null && typeof locationState === "object"
        ? locationState
        : {};
    void setSearchParams(next, {
      preventScrollReset: true,
      state: {
        ...existingState,
        imageViewerPushed: true,
      } satisfies ImageViewerLocationState,
    });
  };

  return { open };
}

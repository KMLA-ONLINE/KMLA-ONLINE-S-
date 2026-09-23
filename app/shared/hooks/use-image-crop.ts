import { useEffect, useRef, useState } from "react";

interface Pending {
  file: File;
  url: string;
}

/**
 * "파일을 고르면 크롭 다이얼로그를 띄우고, 끝나면 잘린 파일을 돌려준다"를 한 줄로 만든다.
 *
 * ```tsx
 * const { start, cropperProps } = useImageCrop(setAvatarFile);
 * // <input onChange={(e) => { const f = e.target.files?.[0]; if (f) start(f); }} />
 * {cropperProps ? <ImageCropper {...cropperProps} aspect={1} maxOutputEdge={512} round /> : null}
 * ```
 *
 * object URL의 수명이 이 훅의 전부다. URL은 살아 있는 동안 파일 전체를 메모리에 붙잡고 있어서,
 * 하나만 놓쳐도 사진 한 장이 새로고침까지 남는다. 그래서 만든 URL을 ref로 직접 소유한다.
 *
 * - **만들기와 해제는 이벤트 핸들러에서 짝을 맞춘다.** `start()`가 이전 URL을 먼저 해제하고
 *   새 URL을 만든다. 상태 커밋을 기다리지 않으므로, 같은 배치에서 `start()`가 두 번 불려도
 *   중간 URL이 새지 않는다 — 이펙트 cleanup에만 맡기면 커밋되지 못한 쪽이 영원히 남는다.
 * - **`URL.revokeObjectURL`은 상태 updater가 아니라 핸들러 본문에서 부른다.** updater는 순수해야
 *   하고 React가 두 번 부를 수 있다.
 * - **이펙트는 언마운트만 책임진다.** 다이얼로그가 열린 채로 화면을 벗어나는 경우다.
 */
export function useImageCrop(onCropped: (file: File) => void) {
  const [pending, setPending] = useState<Pending | null>(null);
  const ownedUrl = useRef<string | null>(null);

  const release = () => {
    if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    ownedUrl.current = null;
  };

  // `ownedUrl`은 안정적인 ref라 cleanup이 언제 돌든 그 시점의 최신 값을 본다. 최신 콜백을
  // 담아 두는 별도의 ref는 필요 없다.
  useEffect(
    () => () => {
      if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
      ownedUrl.current = null;
    },
    [],
  );

  const clear = () => {
    release();
    setPending(null);
  };

  return {
    start: (file: File) => {
      release();
      const url = URL.createObjectURL(file);
      ownedUrl.current = url;
      setPending({ file, url });
    },
    cropperProps: pending
      ? {
          file: pending.file,
          previewUrl: pending.url,
          onCancel: clear,
          onComplete: (cropped: File) => {
            clear();
            onCropped(cropped);
          },
        }
      : null,
  };
}

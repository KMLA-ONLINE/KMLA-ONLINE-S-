import { useEffect, useRef, useState, type DragEvent } from "react";

/**
 * 파일을 끌어다 놓아 첨부하는 드롭 존(데스크톱 전용 — 모바일에는 드래그가 없다).
 *
 * `dragenter`/`dragleave`는 자식 요소를 넘나들 때마다 발생해 깜빡이므로 depth 카운터로 감싼다.
 * 드롭하면 `onDrop`에 `FileList`를 넘긴다.
 */
export function useFileDrop(onDrop: (files: FileList | null) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const depth = useRef(0);

  // 페이지 내부 요소 드래그도 `dataTransfer`에 "Files"를 싣기 때문에 외부 OS 파일 드롭과 구분이 안 된다. 내부 드래그만 `dragstart`가 뜬다.
  const internalDrag = useRef(false);

  useEffect(() => {
    const begin = () => {
      internalDrag.current = true;
    };

    // `dragend`만 믿으면 드래그 소스 노드가 사라질 때(가상 목록, 리렌더) 플래그가 영구히 켜진다. 종료 경로를 더 받는다.
    const end = () => {
      internalDrag.current = false;
    };

    document.addEventListener("dragstart", begin, true);
    document.addEventListener("dragend", end, true);
    // 버블 단계여야 한다. capture면 드롭 존 핸들러보다 먼저 플래그가 내려가 내부 드래그를 외부 파일로 오판한다.
    document.addEventListener("drop", end);
    document.addEventListener("visibilitychange", end);

    // `window` blur는 쓰지 않는다. 드래그 시작만으로 blur가 뜨는 브라우저가 있어 가드가 풀린다.

    return () => {
      document.removeEventListener("dragstart", begin, true);
      document.removeEventListener("dragend", end, true);
      document.removeEventListener("drop", end);
      document.removeEventListener("visibilitychange", end);
    };
  }, []);

  // 외부에서 끌어온 파일 드래그일 때만 참(내부 요소·텍스트 선택 드래그는 무시).
  const isExternalFileDrag = (event: DragEvent) =>
    !internalDrag.current &&
    Array.from(event.dataTransfer.types).includes("Files");

  const reset = () => {
    depth.current = 0;
    setIsDragging(false);
  };

  const dropHandlers = {
    onDragEnter: (event: DragEvent) => {
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      depth.current += 1;
      setIsDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!isExternalFileDrag(event)) return;
      // preventDefault가 없으면 브라우저가 드롭을 파일 열기로 가로챈다.
      event.preventDefault();
    },
    onDragLeave: (event: DragEvent) => {
      if (!isExternalFileDrag(event)) return;
      depth.current -= 1;
      if (depth.current <= 0) reset();
    },
    onDrop: (event: DragEvent) => {
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      reset();
      onDrop(event.dataTransfer.files);
    },
  };

  return { isDragging, dropHandlers };
}

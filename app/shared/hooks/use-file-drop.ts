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

  // 페이지 내부 요소(채팅 속 이미지 등)를 드래그하면 브라우저가 그 이미지를 `dataTransfer`의
  // `"Files"`로도 실어 보내, 파일 존재 여부만으로는 외부 파일 드롭과 구분되지 않는다. 우리
  // 문서에서 시작된 드래그는 `dragstart`가 뜨지만 외부 OS 파일 드래그는 뜨지 않는다.
  const internalDrag = useRef(false);

  useEffect(() => {
    const begin = () => {
      internalDrag.current = true;
    };

    // `dragend`만으로 내리면 한 번 놓쳤을 때 이 인스턴스가 영구히 꺼진다 — 드래그 소스 노드가
    // 도중에 사라지면(가상 목록, 리렌더) 실제로 발생한다. 오래 사는 작성기에서 그러면 이후 모든
    // OS 파일 드롭이 내부 드래그로 오판된다. 그래서 종료로 볼 수 있는 경로를 더 받는다.
    const end = () => {
      internalDrag.current = false;
    };

    document.addEventListener("dragstart", begin, true);
    document.addEventListener("dragend", end, true);
    // **버블 단계여야 한다.** capture로 달면 드롭 존의 React 핸들러보다 먼저 돌아서, 내부 드래그를
    // 페이지 안에 떨어뜨렸을 때 이미 `false`가 된 플래그를 보고 외부 파일로 오판한다 — 이 훅이
    // 막으려던 바로 그 상황이다. 버블로 두면 드롭 처리가 끝난 뒤에 내려간다.
    document.addEventListener("drop", end);
    document.addEventListener("visibilitychange", end);

    // `window`의 `blur`는 쓰지 않는다. 드래그를 시작하는 것만으로 blur가 뜨는 브라우저가 있어,
    // 그러면 내부 드래그 플래그가 곧바로 풀려 가드가 통째로 무력해진다.

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

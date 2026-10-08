import { useEffect, useId } from "react";

/** 직접 알린 미저장 상태. 첨부만 있는 게시물처럼 입력란에 드러나지 않는 것을 위해 둔다. */
const reported = new Set<string>();

/** 값을 사용자가 손으로 써 넣지 않는 입력. 나머지(비밀번호·숫자·날짜 포함)는 모두 지킨다. */
const NON_TYPED_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * 화면을 다시 불러오면 잃을 작업이 있는지.
 *
 * 묻지 않고 하는 새로고침(앱 업데이트 자동 적용)이 기준으로 삼는다. 업로드처럼 진행 중인
 * 요청은 보지 않으므로, 이 판단만으로 새로고침하는 곳은 사용자가 막 화면을 바꾼 순간처럼
 * 진행 중인 일이 없을 때여야 한다. 입력란은 등록 없이도
 * 본다 — 댓글·메시지처럼 짧은 글도 날아가면 아깝고, 모든 입력 화면이 빠짐없이 알려 주리라
 * 기대할 수는 없다. 미리 채워진 편집 폼도 비어 있지 않으면 지킨다. 잘못 지키면 업데이트가
 * 조금 늦어질 뿐이지만, 잘못 놓치면 쓰던 글이 사라진다.
 */
export function hasUnsavedWork(): boolean {
  if (reported.size > 0) return true;

  for (const field of document.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement
  >("input, textarea")) {
    if (
      field instanceof HTMLInputElement &&
      NON_TYPED_INPUT_TYPES.has(field.type)
    )
      continue;
    if (field.value.trim() !== "") return true;
  }

  for (const editable of document.querySelectorAll(
    "[contenteditable]:not([contenteditable='false'])",
  )) {
    if (editable.textContent?.trim()) return true;
  }

  return false;
}

/** 이 컴포넌트가 떠 있는 동안 `dirty`를 미저장 작업으로 알린다. */
export function useReportUnsavedWork(dirty: boolean): void {
  const id = useId();

  useEffect(() => {
    if (!dirty) return;
    reported.add(id);
    return () => {
      reported.delete(id);
    };
  }, [dirty, id]);
}

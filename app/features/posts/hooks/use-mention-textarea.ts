import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import {
  caretDeletionRange,
  expandDeletionOverMentions,
  isMentionDeleteInput,
  mentionDisplayRanges,
  removedRange,
  sanitizeMentionDisplay,
  type MentionDraftEntry,
} from "~/features/posts/model/mentions";

/**
 * 표시형 멘션(`@홍길동`)을 담는 `textarea`의 편집 규칙. 댓글과 메시지 입력창이 함께 쓴다(기능 명세 §8.14, §13.22).
 * 값과 대상은 부르는 쪽이 들고, 여기서는 멘션을 한 덩어리로 지우고 짝 잃은 표시를 걷으며 그동안 캐럿을 지킨다.
 */
export function useMentionTextarea({
  inputRef,
  draft,
  setDraft,
  entries,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** 입력창이 들고 있는 표시형 값. */
  draft: string;
  setDraft: (next: string) => void;
  entries: MentionDraftEntry[];
}) {
  // 한글 조합 중에는 값과 캐럿을 건드리지 않는다. 쓰던 글자가 끊긴다. 조합 중의 `Enter`도 글자를
  // 확정하는 키라서 부르는 쪽이 이 값을 보고 전송하지 않는다.
  const composing = useRef(false);
  const pendingCaret = useRef<number | null>(null);
  // `beforeinput`이 브라우저에 맡긴 단어·줄 삭제. 바로 뒤의 `onChange`가 지운 자리를 본다.
  const nativeDeletion = useRef(false);

  // React가 제어하는 값을 textarea에 반영한 직후 커서를 옮긴다. animation frame까지 미루면
  // 그 사이 입력한 글자의 중간으로 이전 커서가 돌아갈 수 있다.
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null) return;
    pendingCaret.current = null;

    const element = inputRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(caret, caret);
  }, [draft, inputRef]);

  /** 입력창의 값과 캐럿을 함께 바꾼다. React가 값을 다시 심으면 캐럿이 끝으로 튄다. */
  const replaceDraft = (next: string, caret: number) => {
    if (next === draft) {
      const element = inputRef.current;
      element?.focus();
      element?.setSelectionRange(caret, caret);
      return;
    }
    pendingCaret.current = caret;
    setDraft(next);
  };

  /** `[start, end)`를 `text`로 바꾸고 캐럿을 그 뒤에 둔다. 고른 멘션을 넣을 때 쓴다. */
  const replaceRange = (start: number, end: number, text: string) => {
    replaceDraft(
      draft.slice(0, start) + text + draft.slice(end),
      start + text.length,
    );
  };

  /** 짝 잃은 표시를 걷어낸다. 남겨 두면 깨진 이름을 다시 쳤을 때 멘션이 조용히 되살아난다. */
  const repairDraft = (element: HTMLTextAreaElement) => {
    const value = element.value;
    const next = sanitizeMentionDisplay(value, entries);
    if (next === value) {
      setDraft(value);
      return;
    }

    const caret = element.selectionStart ?? value.length;
    replaceDraft(next, Math.max(0, caret - (value.length - next.length)));
  };

  /** 멘션은 한 덩어리로 지운다(`expandDeletionOverMentions()`). 반쪽이 남으면 멘션이 아닌 채로 조용히 되살아난다. */
  const deleteAtomically = (
    element: HTMLTextAreaElement,
    inputType: string,
  ) => {
    const { selectionStart: from, selectionEnd: to } = element;
    // `textarea`는 `getTargetRanges()`가 늘 비어 있어 선택 영역으로 판단한다. 캐럿만 둔 단어·줄
    // 삭제는 어디까지 지울지 알 수 없어 브라우저에 지우게 하고 `widenNativeDeletion()`이 넓힌다.
    if (from === to && !inputType.startsWith("deleteContent")) {
      nativeDeletion.current = true;
      return false;
    }
    const range = expandDeletionOverMentions(
      caretDeletionRange({ from, to }, inputType),
      mentionDisplayRanges(draft, entries),
    );
    if (!range) return false;
    replaceDraft(
      draft.slice(0, range.from) + draft.slice(range.to),
      range.from,
    );
    return true;
  };
  // 커밋 직후 들어온 입력도 그 커밋의 초안을 보게 그리기 전에 바꿔 단다.
  const deleteAtomicallyRef = useRef(deleteAtomically);
  useLayoutEffect(() => {
    deleteAtomicallyRef.current = deleteAtomically;
  });

  /** 브라우저가 지운 단어·줄이 멘션에 걸쳤으면 그 멘션까지 지운다. 넓혔으면 `true`. */
  const widenNativeDeletion = (element: HTMLTextAreaElement) => {
    if (!nativeDeletion.current) return false;
    nativeDeletion.current = false;
    const removed = removedRange(draft, element.value, element.selectionStart);
    const range =
      removed &&
      expandDeletionOverMentions(removed, mentionDisplayRanges(draft, entries));
    if (!range) return false;
    replaceDraft(
      draft.slice(0, range.from) + draft.slice(range.to),
      range.from,
    );
    return true;
  };

  // React의 `onBeforeInput`은 `inputType`이 없는 합성 이벤트라 DOM에 직접 단다. 모바일 키보드는
  // Backspace를 keyCode 229로 보내 keydown으로는 알 수 없다.
  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    const onBeforeInput = (event: InputEvent) => {
      nativeDeletion.current = false;
      if (!isMentionDeleteInput(event.inputType)) return;
      if (composing.current || event.isComposing) return;
      if (deleteAtomicallyRef.current(element, event.inputType))
        event.preventDefault();
    };
    element.addEventListener("beforeinput", onBeforeInput);
    return () => element.removeEventListener("beforeinput", onBeforeInput);
  }, [inputRef]);

  return {
    composing,
    replaceDraft,
    replaceRange,
    /** `onChange`. 조합 중에는 값만 받고, 조합이 끝나면 `handleCompositionEnd`가 정리한다. */
    handleChange: (element: HTMLTextAreaElement) => {
      if (composing.current) setDraft(element.value);
      else if (!widenNativeDeletion(element)) repairDraft(element);
    },
    handleCompositionStart: () => {
      composing.current = true;
    },
    handleCompositionEnd: (element: HTMLTextAreaElement) => {
      composing.current = false;
      repairDraft(element);
    },
  };
}

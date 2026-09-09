import {
  lazy,
  Suspense,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from "react";

import { buildMentionToken } from "~/features/posts/model/mentions";
import { cn } from "~/shared/lib/utils";
import { Textarea } from "~/shared/ui/textarea";

const DesktopMarkdownEditor = lazy(
  () => import("~/features/posts/components/editor/desktop-markdown-editor"),
);

/** 바깥(멘션 버튼)에서 커서 자리에 무언가를 넣기 위한 손잡이. */
export interface PostBodyInputHandle {
  insertMention(label: string, ordinal: number): void;
}

export function PostBodyInput({
  value,
  onValueChange,
  className,
  handleRef,
}: {
  value: string;
  onValueChange?: (value: string) => void;
  className?: string;
  handleRef?: RefObject<PostBodyInputHandle | null>;
}) {
  const [desktop, setDesktop] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  // 모바일은 Markdown 원문을 그대로 편집하므로 토큰도 글자로 넣는다. 데스크톱 쪽 손잡이는
  // Milkdown 이 직접 등록한다.
  useImperativeHandle(
    handleRef,
    () => ({
      insertMention(label: string, ordinal: number) {
        const element = textarea.current;
        if (!element) return;
        const token = `${buildMentionToken(label, ordinal)} `;
        const start = element.selectionStart ?? element.value.length;
        const end = element.selectionEnd ?? start;
        const next =
          element.value.slice(0, start) + token + element.value.slice(end);
        onValueChange?.(next);
        // 값 반영이 끝난 다음 프레임에 커서를 옮긴다. 제어 컴포넌트라 이 시점의 DOM 값은
        // 아직 옛것이다.
        requestAnimationFrame(() => {
          const caret = start + token.length;
          element.focus();
          element.setSelectionRange(caret, caret);
        });
      },
    }),
    [onValueChange],
  );

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  if (!desktop)
    return (
      <Textarea
        ref={textarea}
        name="body"
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
        maxLength={20_000}
        aria-label="Markdown 본문"
        placeholder="본문을 입력하세요"
        className={cn(
          "post-typography field-sizing-fixed h-full max-h-none min-h-72 resize-none overflow-y-auto whitespace-pre-wrap md:hidden",
          className,
        )}
      />
    );

  return (
    <Suspense
      fallback={<div className="min-h-96 rounded-md border" aria-busy="true" />}
    >
      <DesktopMarkdownEditor
        initialValue={value}
        onValueChange={onValueChange}
        handleRef={handleRef}
      />
    </Suspense>
  );
}

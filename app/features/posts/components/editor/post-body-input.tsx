import { lazy, Suspense, type RefObject } from "react";

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
  return (
    <Suspense
      fallback={
        <div className="min-h-72 rounded-md border md:h-72" aria-busy="true" />
      }
    >
      <DesktopMarkdownEditor
        initialValue={value}
        onValueChange={onValueChange}
        handleRef={handleRef}
        className={className}
      />
    </Suspense>
  );
}

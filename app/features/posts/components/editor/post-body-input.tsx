import { lazy, Suspense, type RefObject } from "react";

const DesktopMarkdownEditor = lazy(
  () => import("~/features/posts/components/editor/desktop-markdown-editor"),
);

/** 바깥(멘션 버튼)에서 커서 자리에 무언가를 넣기 위한 손잡이. */
export interface PostBodyInputHandle {
  /** 여러 멘션을 공백으로 이어 한 번에 넣는다. 실행 취소 한 번에 함께 사라진다. */
  insertMentions(mentions: { label: string; ordinal: number }[]): void;
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
        <div
          className="h-[clamp(18rem,50dvh,32rem)] rounded-md border md:h-80"
          aria-busy="true"
        />
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

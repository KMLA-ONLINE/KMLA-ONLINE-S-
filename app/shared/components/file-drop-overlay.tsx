import { ImagePlusIcon } from "lucide-react";

/**
 * 드래그 중인 드롭 존 위에 겹치는 안내.
 *
 * `pointer-events-none`이라 드래그·드롭 이벤트는 아래 드롭 존으로 그대로 통과한다. 감싸는
 * 컨테이너에는 `position`이 있어야 한다(`relative`·`fixed` 등).
 */
export function FileDropOverlay({
  label = "여기에 놓아 첨부하기",
}: {
  label?: string;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/85 p-3">
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary text-primary">
        <ImagePlusIcon className="size-8" aria-hidden="true" />
        <p className="text-sm font-medium">{label}</p>
      </div>
    </div>
  );
}

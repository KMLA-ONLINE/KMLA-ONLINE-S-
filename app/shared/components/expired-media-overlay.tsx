export const EXPIRED_MEDIA_LABEL = "보관 기간 만료";

/** 파일이 지워진 미디어 칸을 덮는 표시. 부모가 `relative`여야 한다. */
export function ExpiredMediaOverlay() {
  return (
    <span className="absolute inset-0 flex items-center justify-center bg-black/55 px-2 text-center text-sm font-medium text-white">
      {EXPIRED_MEDIA_LABEL}
    </span>
  );
}

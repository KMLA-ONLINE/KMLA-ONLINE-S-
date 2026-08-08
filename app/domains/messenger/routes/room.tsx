import { PageHeader } from "~/domains/shell";

/**
 * `messenger/:roomId`. 대화 목록만 스크롤하고 입력창은 바닥에 붙어 있다 — `document`/`focused`의
 * 스크롤 컨테이너로는 만들 수 없는 배치라 `immersive`가 따로 있는 것이다.
 */
export default function MessengerRoomPage() {
  return (
    <>
      {/* 모바일에서만 보인다. 데스크톱은 오른쪽 패널에 방 제목이 따로 붙는다. */}
      <PageHeader title="대화" back="/messenger" />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 text-sm text-muted-foreground">
        메시지 목록이 들어갑니다.
      </div>

      <div className="shrink-0 border-t p-3 pb-[calc(0.75rem+var(--app-safe-b))] text-sm text-muted-foreground">
        입력창이 들어갑니다.
      </div>
    </>
  );
}

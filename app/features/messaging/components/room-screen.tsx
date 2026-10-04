export function RoomScreen() {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 text-sm text-muted-foreground">
        메시지 목록이 들어갑니다.
      </div>

      <div className="shrink-0 border-t p-3 pb-[calc(0.75rem+var(--app-safe-b))] text-sm text-muted-foreground">
        입력창이 들어갑니다.
      </div>
    </>
  );
}

/**
 * 이 대화의 메시지 Push 카드를 알림센터에서 닫는다. 앱에서 읽었으면 카드를 남길 이유가 없다. 카드의
 * tag는 서비스 워커(`public/push-sw.js`)가 정하는 `message:<대화 ID>`다. 서비스 워커나 Notifications
 * API가 없는 환경은 정상 경로이므로 실패는 삼킨다.
 */
export async function closeMessageNotifications(
  conversationId: string,
): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const cards =
      (await registration?.getNotifications({
        tag: `message:${conversationId}`,
      })) ?? [];
    for (const card of cards) card.close();
  } catch {
    // 지원하지 않거나 권한이 없는 환경.
  }
}

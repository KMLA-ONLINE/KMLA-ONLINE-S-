import { data } from "react-router";

import { defineAppChrome } from "~/features/app-shell";
import {
  getNotificationPreferences,
  getPushSupport,
  listMyGroupNotificationPreferences,
  setMessagePreviewHidden,
  updateGroupNotificationPreferences,
  updateNotificationPreferences,
} from "~/features/notifications";
import { NotificationSettings } from "~/features/notifications/components/notification-settings";
import type { NotificationPreferences } from "~/features/notifications";
import { getCurrentLocale, translate } from "~/shared/i18n";
import type { Route } from "./+types/notification-settings";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "2xl",
});

/**
 * 기기의 Push 상태는 서비스 워커와 서버 구독 확인을 거쳐 가장 늦고, 화면에서는 Push 카드 하나만 쓴다.
 * 그래서 기다리지 않고 promise째 넘긴다. 실패하면 카드만 "확인 실패"로 그린다.
 */
export async function clientLoader() {
  const pushSupport = getPushSupport().catch((error: unknown) => {
    console.error("Failed to read Web Push support", error);
    return null;
  });
  const [preferences, groupPreferences] = await Promise.all([
    getNotificationPreferences(),
    listMyGroupNotificationPreferences(),
  ]);
  return { preferences, pushSupport, groupPreferences };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const locale = getCurrentLocale();
  if (formData.get("intent") === "group-preferences") {
    const groupId = formData.get("groupId");
    const level = formData.get("level");
    if (
      typeof groupId !== "string" ||
      (level !== "none" && level !== "direct" && level !== "all")
    ) {
      return data(
        { error: translate(locale, "그룹 알림 설정이 올바르지 않습니다.") },
        { status: 400 },
      );
    }
    try {
      await updateGroupNotificationPreferences(
        groupId,
        level,
        level !== "none" && formData.get("contentPushEnabled") === "true",
        level === "all" && formData.get("newPostPushEnabled") === "true",
      );
      return { saved: true };
    } catch (error) {
      console.error("Failed to update group notification preferences", error);
      return data(
        { error: translate(locale, "그룹 알림 설정을 저장하지 못했습니다.") },
        { status: 503 },
      );
    }
  }

  if (formData.get("intent") === "message-preview") {
    try {
      await setMessagePreviewHidden(formData.get("hidden") === "true");
      return { saved: true };
    } catch (error) {
      console.error("Failed to update message preview setting", error);
      return data(
        { error: translate(locale, "메시지 알림 설정을 저장하지 못했습니다.") },
        { status: 503 },
      );
    }
  }

  if (formData.get("intent") !== "preferences") {
    return data(
      { error: translate(locale, "지원하지 않는 요청입니다.") },
      { status: 400 },
    );
  }

  const preferences = Object.fromEntries(
    [
      "account_push_enabled",
      "content_push_enabled",
      "group_push_enabled",
      "school_push_enabled",
      "timeline_push_enabled",
    ].map((key) => [key, formData.get(key) === "true"]),
  ) as unknown as NotificationPreferences;
  try {
    await updateNotificationPreferences(preferences);
    return { saved: true };
  } catch (error) {
    console.error("Failed to update notification preferences", error);
    return data(
      { error: translate(locale, "알림 설정을 저장하지 못했습니다.") },
      { status: 503 },
    );
  }
}

export default function NotificationSettingsRoute({
  loaderData,
}: Route.ComponentProps) {
  return (
    <NotificationSettings
      initialPreferences={loaderData.preferences}
      pushSupport={loaderData.pushSupport}
      groupPreferences={loaderData.groupPreferences}
    />
  );
}

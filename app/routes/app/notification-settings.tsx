import { data } from "react-router";

import { defineAppChrome } from "~/features/app-shell";
import {
  getNotificationPreferences,
  getPushSupport,
  listMyGroupNotificationPreferences,
  updateGroupNotificationPreferences,
  updateNotificationPreferences,
} from "~/features/notifications";
import { NotificationSettings } from "~/features/notifications/components/notification-settings";
import type { NotificationPreferences } from "~/features/notifications";
import type { Route } from "./+types/notification-settings";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "2xl",
});

export async function clientLoader() {
  const [preferences, pushSupport, groupPreferences] = await Promise.all([
    getNotificationPreferences(),
    getPushSupport(),
    listMyGroupNotificationPreferences(),
  ]);
  return { preferences, pushSupport, groupPreferences };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  if (formData.get("intent") === "group-preferences") {
    const groupId = formData.get("groupId");
    const level = formData.get("level");
    if (
      typeof groupId !== "string" ||
      (level !== "none" && level !== "direct" && level !== "all")
    ) {
      return data(
        { error: "그룹 알림 설정이 올바르지 않습니다." },
        { status: 400 },
      );
    }
    await updateGroupNotificationPreferences(
      groupId,
      level,
      level !== "none" && formData.get("contentPushEnabled") === "true",
      level === "all" && formData.get("newPostPushEnabled") === "true",
    );
    return { saved: true };
  }

  if (formData.get("intent") !== "preferences") {
    return data({ error: "지원하지 않는 요청입니다." }, { status: 400 });
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
  await updateNotificationPreferences(preferences);
  return { saved: true };
}

export default function NotificationSettingsRoute({
  loaderData,
}: Route.ComponentProps) {
  return (
    <NotificationSettings
      initialPreferences={loaderData.preferences}
      initialPushSupport={loaderData.pushSupport}
      groupPreferences={loaderData.groupPreferences}
    />
  );
}

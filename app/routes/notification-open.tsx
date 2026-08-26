import { redirect } from "react-router";

import {
  resolveNotificationDestination,
  sanitizeNotificationDestination,
} from "~/features/notifications";
import type { Route } from "./+types/notification-open";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const notificationId = params.notificationId;
  if (!notificationId) throw redirect("/noti");

  const destination = await resolveNotificationDestination(notificationId);
  if (destination === null) {
    const next = `/noti/open/${encodeURIComponent(notificationId)}`;
    throw redirect(`/login?${new URLSearchParams({ next })}`);
  }

  throw redirect(sanitizeNotificationDestination(destination));
}

export default function NotificationOpenRoute() {
  return null;
}

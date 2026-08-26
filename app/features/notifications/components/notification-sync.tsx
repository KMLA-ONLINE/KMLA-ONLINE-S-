import { useEffect, useEffectEvent } from "react";
import { useRevalidator } from "react-router";

import { subscribeToNotifications } from "~/features/notifications/data/subscriptions";

export function NotificationSync() {
  const revalidator = useRevalidator();
  const revalidate = useEffectEvent(() => void revalidator.revalidate());

  useEffect(() => subscribeToNotifications(revalidate), []);
  useEffect(() => {
    const onFocus = () => revalidate();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return null;
}

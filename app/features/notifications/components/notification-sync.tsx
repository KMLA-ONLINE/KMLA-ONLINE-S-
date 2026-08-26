import { useEffect, useEffectEvent } from "react";
import { useRevalidator } from "react-router";

import { subscribeToNotifications } from "~/features/notifications/data/subscriptions";

export function NotificationSync({ profileId }: { profileId: number }) {
  const revalidator = useRevalidator();
  const revalidate = useEffectEvent(() => void revalidator.revalidate());

  useEffect(() => subscribeToNotifications(profileId, revalidate), [profileId]);
  useEffect(() => {
    const onFocus = () => revalidate();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return null;
}

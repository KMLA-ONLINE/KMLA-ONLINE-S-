import { useEffect, useEffectEvent } from "react";
import { useRevalidator } from "react-router";

import { subscribeToNotifications } from "~/features/notifications/data/subscriptions";
import { refreshWebPushForeground } from "~/features/notifications/data/push";

const FOREGROUND_REFRESH_INTERVAL_MS = 30_000;

export function NotificationSync({ profileId }: { profileId: number }) {
  const revalidator = useRevalidator();
  const revalidate = useEffectEvent(() => void revalidator.revalidate());

  useEffect(() => subscribeToNotifications(profileId, revalidate), [profileId]);
  useEffect(() => {
    const onFocus = () => revalidate();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const refresh = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus())
        return;
      // Presence is advisory. A transient failure must not interrupt the app;
      // the next interval retries and the server-side value expires by itself.
      void refreshWebPushForeground().catch(() => undefined);
    };
    const sync = () => {
      stop();
      if (document.visibilityState !== "visible" || !document.hasFocus())
        return;
      refresh();
      timer = setInterval(refresh, FOREGROUND_REFRESH_INTERVAL_MS);
    };

    window.addEventListener("focus", sync);
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      stop();
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return null;
}

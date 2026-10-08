import { useCallback, useEffect, useRef, useState } from "react";
import type { Workbox } from "workbox-window";

import { hasUnsavedWork } from "~/shared/lib/unsaved-work";

const reloadPage = () => window.location.reload();
const UPDATE_POLL_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_CHECK_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Registers the Workbox service worker that `scripts/build-sw.mjs` emits.
 *
 * We drive `workbox-window` directly instead of the `virtual:pwa-register`
 * module so this hook resolves under Vitest, where no PWA Vite plugin is
 * loaded. `workbox-window` is imported lazily for the same reason.
 *
 * 새 빌드는 묻지 않고 바로 활성화된다(`skipWaiting: true`). 그 순간부터 이 페이지가 돌리는
 * JS는 옛 빌드이고, 새 워커는 옛 청크를 precache에서 지운다. 남은 일은 페이지를 다시
 * 불러오는 것뿐이라 잃을 것이 없는 순간에 한다 — 앱을 연 뒤 아직 아무것도 만지지 않았을
 * 때, 앱이 화면에서 내려갈 때. 그 밖에는 `updateActivated`를 보고 다음 화면 이동이
 * 새로 불러온다(`useReloadOnNavigation`).
 */
export function useServiceWorker(reload = reloadPage) {
  const [updateActivated, setUpdateActivated] = useState(false);
  const checkNowRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    let interacted = false;
    let activated = false;
    let stopUpdateChecks: (() => void) | null = null;

    const reloadIfQuiet = () => {
      if (activated && !hasUnsavedWork()) reload();
    };

    // 앱을 연 직후에는 옛 화면이 먼저 뜨고 새 워커 설치가 몇 초 뒤에 끝난다. 그때까지
    // 사용자가 아무것도 만지지 않았다면 다시 불러와도 잃는 것이 없다.
    const markInteracted = () => {
      interacted = true;
      window.removeEventListener("pointerdown", markInteracted, true);
      window.removeEventListener("keydown", markInteracted, true);
    };
    window.addEventListener("pointerdown", markInteracted, true);
    window.addEventListener("keydown", markInteracted, true);

    // 다른 앱·탭으로 넘어가는 순간은 다시 불러와도 사용자가 보지 못한다.
    const onHidden = () => {
      if (document.visibilityState === "hidden") reloadIfQuiet();
    };
    document.addEventListener("visibilitychange", onHidden);

    void (async () => {
      const { Workbox } = await import("workbox-window");
      if (cancelled) return;

      const wb: Workbox = new Workbox("/sw.js", {
        scope: "/",
        // Always revalidate imported Push handlers as part of an SW update.
        updateViaCache: "none",
      });

      wb.addEventListener("controlling", (event) => {
        // clientsClaim also fires this on the first install, when the page
        // already runs the build the worker precached.
        if (!event.isUpdate) return;

        activated = true;
        setUpdateActivated(true);
        if (!interacted || document.visibilityState === "hidden") {
          reloadIfQuiet();
        }
      });

      await wb.register();
      if (cancelled) return;

      // sw.js is only refetched on a document navigation, which an SPA never does, so poll for updates ourselves.
      let lastCheckedAt = Date.now();
      const runCheck = () => {
        lastCheckedAt = Date.now();
        void wb.update().catch(() => {
          // Offline, or the deploy is mid-flight. The next check picks it up.
        });
      };
      const checkForUpdate = () => {
        // A hidden tab reloads on its own once the worker changes, but checking
        // costs a request for nobody; the visible check below covers the return.
        if (document.visibilityState !== "visible") return;
        if (Date.now() - lastCheckedAt < UPDATE_CHECK_THROTTLE_MS) return;
        runCheck();
      };
      checkNowRef.current = runCheck;

      const pollTimer = window.setInterval(
        checkForUpdate,
        UPDATE_POLL_INTERVAL_MS,
      );
      // Returning to the app is the moment a stale build is most likely; the
      // interval only covers sessions left open.
      document.addEventListener("visibilitychange", checkForUpdate);
      window.addEventListener("online", checkForUpdate);

      stopUpdateChecks = () => {
        checkNowRef.current = null;
        window.clearInterval(pollTimer);
        document.removeEventListener("visibilitychange", checkForUpdate);
        window.removeEventListener("online", checkForUpdate);
      };
    })().catch(() => {
      // `register()` can reject (missing sw.js, SecurityError); the app works without a SW, so don't leave an unhandled rejection.
    });

    return () => {
      cancelled = true;
      markInteracted();
      document.removeEventListener("visibilitychange", onHidden);
      stopUpdateChecks?.();
    };
  }, [reload]);

  /** 쓰로틀 없이 지금 새 빌드를 확인한다. 업데이트가 강제된 동안 새 빌드를 기다릴 때 쓴다. */
  const checkForUpdateNow = useCallback(() => {
    checkNowRef.current?.();
  }, []);

  return { updateActivated, checkForUpdateNow };
}

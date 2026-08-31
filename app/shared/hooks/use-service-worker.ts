import { useCallback, useEffect, useRef, useState } from "react";
import type { Workbox } from "workbox-window";

const reloadPage = () => window.location.reload();
const OFFLINE_READY_DURATION_MS = 5000;
const APPLY_UPDATE_TIMEOUT_MS = 5000;
const UPDATE_POLL_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_CHECK_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Registers the Workbox service worker that `scripts/build-sw.mjs` emits.
 *
 * We drive `workbox-window` directly instead of the `virtual:pwa-register`
 * module so this hook resolves under Vitest, where no PWA Vite plugin is
 * loaded. `workbox-window` is imported lazily for the same reason.
 *
 * The generated SW runs with `skipWaiting: false`, so a new build sits in the
 * `waiting` state until the user accepts — no reload is ever forced mid-scroll.
 */
export function useServiceWorker(reload = reloadPage) {
  const [updateReady, setUpdateReady] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [updateAppliedElsewhere, setUpdateAppliedElsewhere] = useState(false);
  const wbRef = useRef<Workbox | null>(null);
  const offlineReadyTimerRef = useRef<number | null>(null);
  const applyTimeoutRef = useRef<number | null>(null);
  const updateAcceptedRef = useRef(false);
  const updateAppliedElsewhereRef = useRef(false);

  const clearApplyTimeout = useCallback(() => {
    if (applyTimeoutRef.current === null) return;
    window.clearTimeout(applyTimeoutRef.current);
    applyTimeoutRef.current = null;
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    let stopUpdateChecks: (() => void) | null = null;

    void (async () => {
      const { Workbox } = await import("workbox-window");
      if (cancelled) return;

      const wb = new Workbox("/sw.js", {
        scope: "/",
        // Always revalidate imported Push handlers as part of an SW update.
        updateViaCache: "none",
      });
      wbRef.current = wb;

      wb.addEventListener("waiting", () => {
        clearApplyTimeout();
        updateAcceptedRef.current = false;
        updateAppliedElsewhereRef.current = false;
        setApplyingUpdate(false);
        setUpdateAppliedElsewhere(false);
        setOfflineReady(false);
        setUpdateReady(true);
      });
      wb.addEventListener("activated", (event) => {
        if (!event.isUpdate) {
          setOfflineReady(true);
          offlineReadyTimerRef.current = window.setTimeout(
            () => setOfflineReady(false),
            OFFLINE_READY_DURATION_MS,
          );
        }
      });
      wb.addEventListener("controlling", (event) => {
        // clientsClaim also fires this on the first install. Only updates that
        // this tab accepted may interrupt the current page automatically.
        if (!event.isUpdate) return;

        if (updateAcceptedRef.current) {
          clearApplyTimeout();
          reload();
          return;
        }

        updateAppliedElsewhereRef.current = true;
        setUpdateAppliedElsewhere(true);
        setOfflineReady(false);
        setUpdateReady(true);
      });

      await wb.register();
      if (cancelled) return;

      // The browser only refetches sw.js on a document navigation, and this app
      // is an SPA: after the first load it never performs one. Left alone, an
      // installed app that lives in the background for days would keep running
      // the build it launched with and the update banner would have nothing to
      // announce. So we ask ourselves.
      let lastCheckedAt = Date.now();
      const checkForUpdate = () => {
        // A background tab cannot show the banner anyway, and the visible check
        // below fires the moment it comes back.
        if (document.visibilityState !== "visible") return;
        if (Date.now() - lastCheckedAt < UPDATE_CHECK_THROTTLE_MS) return;
        lastCheckedAt = Date.now();
        void wb.update().catch(() => {
          // Offline, or the deploy is mid-flight. The next check picks it up.
        });
      };

      const pollTimer = window.setInterval(
        checkForUpdate,
        UPDATE_POLL_INTERVAL_MS,
      );
      // Returning to the app is the moment a stale build is most likely and the
      // banner is most welcome; the interval only covers sessions left open.
      document.addEventListener("visibilitychange", checkForUpdate);
      window.addEventListener("online", checkForUpdate);

      stopUpdateChecks = () => {
        window.clearInterval(pollTimer);
        document.removeEventListener("visibilitychange", checkForUpdate);
        window.removeEventListener("online", checkForUpdate);
      };
    })().catch(() => {
      // `register()` can reject outright — sw.js missing after a bad deploy, or
      // a SecurityError under a locked-down profile. The app is fully usable
      // without a service worker, so this must not become an unhandled
      // rejection.
    });

    return () => {
      cancelled = true;
      stopUpdateChecks?.();
      clearApplyTimeout();
      if (offlineReadyTimerRef.current !== null) {
        window.clearTimeout(offlineReadyTimerRef.current);
      }
    };
  }, [clearApplyTimeout, reload]);

  const applyUpdate = useCallback(() => {
    setApplyingUpdate(true);

    if (updateAppliedElsewhereRef.current) {
      reload();
      return;
    }

    updateAcceptedRef.current = true;
    // `messageSkipWaiting()`은 대답을 약속하지 않는다. 대기 중이던 워커가 이미
    // redundant가 됐거나 메시지가 유실되면 `controlling`이 끝내 오지 않고, 버튼은
    // "적용 중"에 disabled로 갇혀 사용자가 빠져나올 길이 없어진다. 그때는 버튼에
    // 적힌 대로 새로고침한다 — 업데이트가 실제로 적용되지 않았더라도 다음 등록에서
    // 배너가 다시 떠서 막다른 길로는 남지 않는다.
    applyTimeoutRef.current = window.setTimeout(
      reload,
      APPLY_UPDATE_TIMEOUT_MS,
    );
    void wbRef.current?.messageSkipWaiting();
  }, [reload]);

  const dismissOfflineReady = useCallback(() => setOfflineReady(false), []);

  return {
    updateReady,
    offlineReady,
    applyingUpdate,
    updateAppliedElsewhere,
    applyUpdate,
    dismissOfflineReady,
  };
}

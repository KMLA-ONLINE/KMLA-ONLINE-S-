import { useCallback, useEffect, useRef, useState } from "react";
import type { Workbox } from "workbox-window";

const reloadPage = () => window.location.reload();
const OFFLINE_READY_DURATION_MS = 5000;

/**
 * Registers the Workbox service worker emitted by `vite-plugin-pwa`.
 *
 * We drive `workbox-window` directly instead of the `virtual:pwa-register`
 * module so this hook resolves under Vitest, where the PWA Vite plugin is not
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
  const updateAcceptedRef = useRef(false);
  const updateAppliedElsewhereRef = useRef(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

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
          reload();
          return;
        }

        updateAppliedElsewhereRef.current = true;
        setUpdateAppliedElsewhere(true);
        setOfflineReady(false);
        setUpdateReady(true);
      });

      await wb.register();
    })();

    return () => {
      cancelled = true;
      if (offlineReadyTimerRef.current !== null) {
        window.clearTimeout(offlineReadyTimerRef.current);
      }
    };
  }, [reload]);

  const applyUpdate = useCallback(() => {
    setApplyingUpdate(true);

    if (updateAppliedElsewhereRef.current) {
      reload();
      return;
    }

    updateAcceptedRef.current = true;
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

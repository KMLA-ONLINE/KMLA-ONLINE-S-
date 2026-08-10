import { useCallback, useEffect, useRef, useState } from "react";
import type { Workbox } from "workbox-window";

const reloadPage = () => window.location.reload();

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
  const wbRef = useRef<Workbox | null>(null);
  const updateAcceptedRef = useRef(false);
  const updateAppliedElsewhereRef = useRef(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    void (async () => {
      const { Workbox } = await import("workbox-window");
      if (cancelled) return;

      const wb = new Workbox("/sw.js", { scope: "/" });
      wbRef.current = wb;

      wb.addEventListener("waiting", () => setUpdateReady(true));
      wb.addEventListener("activated", (event) => {
        if (!event.isUpdate) setOfflineReady(true);
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
        setUpdateReady(true);
      });

      await wb.register();
    })();

    return () => {
      cancelled = true;
    };
  }, [reload]);

  const applyUpdate = useCallback(() => {
    setUpdateReady(false);

    if (updateAppliedElsewhereRef.current) {
      reload();
      return;
    }

    updateAcceptedRef.current = true;
    void wbRef.current?.messageSkipWaiting();
  }, [reload]);

  const dismissOfflineReady = useCallback(() => setOfflineReady(false), []);

  return { updateReady, offlineReady, applyUpdate, dismissOfflineReady };
}

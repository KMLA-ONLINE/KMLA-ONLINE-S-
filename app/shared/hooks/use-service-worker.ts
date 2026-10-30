import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Workbox } from "workbox-window";

const reloadPage = () => window.location.reload();
const APPLY_UPDATE_TIMEOUT_MS = 5000;
const UPDATE_POLL_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_CHECK_THROTTLE_MS = 5 * 60 * 1000;

/** 수동 확인의 결과. `found`는 새 빌드를 받는 중이라 곧 `updateReady`가 된다. */
export type UpdateCheckResult = "latest" | "found" | "failed";

export interface AppUpdateState {
  updateReady: boolean;
  applyingUpdate: boolean;
  updateAppliedElsewhere: boolean;
  /** 서비스 워커가 없으면(개발 서버, 미지원 브라우저) null이다. */
  checkForUpdate: (() => Promise<UpdateCheckResult>) | null;
  applyUpdate: () => void;
}

/**
 * 워커는 루트의 `useServiceWorker` 하나가 소유한다. 설정 화면의 버전 카드가 같은 상태를
 * 읽고 같은 확인·적용을 부르도록 그 훅이 여기에 내놓는다. 두 번째 Workbox를 만들면 이벤트가 갈라진다.
 */
const INITIAL_APP_UPDATE: AppUpdateState = {
  updateReady: false,
  applyingUpdate: false,
  updateAppliedElsewhere: false,
  checkForUpdate: null,
  applyUpdate: () => undefined,
};
let appUpdate = INITIAL_APP_UPDATE;
const appUpdateListeners = new Set<() => void>();

function publishAppUpdate(next: Partial<AppUpdateState>) {
  appUpdate = { ...appUpdate, ...next };
  appUpdateListeners.forEach((listener) => listener());
}

function subscribeAppUpdate(listener: () => void) {
  appUpdateListeners.add(listener);
  return () => appUpdateListeners.delete(listener);
}

/** 루트의 `useServiceWorker`가 내놓은 업데이트 상태와 동작. */
export function useAppUpdate(): AppUpdateState {
  return useSyncExternalStore(
    subscribeAppUpdate,
    () => appUpdate,
    () => INITIAL_APP_UPDATE,
  );
}

export function resetAppUpdateForTests(): void {
  appUpdate = INITIAL_APP_UPDATE;
}

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
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [updateAppliedElsewhere, setUpdateAppliedElsewhere] = useState(false);
  const wbRef = useRef<Workbox | null>(null);
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
        setUpdateReady(true);
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
        setUpdateReady(true);
      });

      await wb.register();
      if (cancelled) return;

      // sw.js is only refetched on a document navigation, which an SPA never does, so poll for updates ourselves.
      let lastCheckedAt = Date.now();

      // 사람이 누른 확인은 쓰로틀을 건너뛴다. 새 빌드를 찾으면 `waiting`이 이어서 와 배너와 카드가 함께 바뀐다.
      publishAppUpdate({
        checkForUpdate: async () => {
          lastCheckedAt = Date.now();
          try {
            await wb.update();
          } catch {
            return "failed";
          }
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.installing || registration?.waiting
            ? "found"
            : "latest";
        },
      });

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
      // `register()` can reject (missing sw.js, SecurityError); the app works without a SW, so don't leave an unhandled rejection.
    });

    return () => {
      cancelled = true;
      wbRef.current = null;
      stopUpdateChecks?.();
      clearApplyTimeout();
      publishAppUpdate({ checkForUpdate: null });
    };
  }, [clearApplyTimeout, reload]);

  const applyUpdate = useCallback(() => {
    setApplyingUpdate(true);

    if (updateAppliedElsewhereRef.current) {
      reload();
      return;
    }

    updateAcceptedRef.current = true;
    // `skipWaiting()` 뒤에도 브라우저는 옛 워커가 붙잡은 요청(느린 이미지 등)이 끝날 때까지 활성화를
    // 미룬다. 그 전에 새로고침하면 새 워커는 여전히 대기 중이라 배너가 다시 뜨고, 새 페이지가 옛 워커에
    // 요청을 또 얹어 같은 일이 반복된다. 그래서 시간이 지나도 대기 중이면 메시지를 다시 보내고 더 기다리며,
    // 대기 워커가 사라졌을 때(활성화됐거나 더 새 빌드에 밀려 폐기됨)만 `controlling` 대신 새로고침한다.
    const waitForActivation = () => {
      applyTimeoutRef.current = window.setTimeout(() => {
        applyTimeoutRef.current = null;
        void navigator.serviceWorker.getRegistration().then((registration) => {
          if (!updateAcceptedRef.current || !wbRef.current) return;
          if (registration?.waiting) {
            void wbRef.current.messageSkipWaiting();
            waitForActivation();
            return;
          }
          reload();
        }, reload);
      }, APPLY_UPDATE_TIMEOUT_MS);
    };
    waitForActivation();
    void wbRef.current?.messageSkipWaiting();
  }, [reload]);

  useEffect(() => {
    publishAppUpdate({
      updateReady,
      applyingUpdate,
      updateAppliedElsewhere,
      applyUpdate,
    });
  }, [updateReady, applyingUpdate, updateAppliedElsewhere, applyUpdate]);

  return {
    updateReady,
    applyingUpdate,
    updateAppliedElsewhere,
    applyUpdate,
  };
}

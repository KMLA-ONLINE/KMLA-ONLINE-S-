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
 * 워커는 루트의 `useServiceWorker` 하나가 소유한다. 설정·업데이트 기록 화면의 버전 카드가 같은 상태를
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
    // `messageSkipWaiting()`은 응답을 보장하지 않는다. `controlling`이 안 오면 버튼이 "적용 중"에 갇히므로 그때는 새로고침한다.
    applyTimeoutRef.current = window.setTimeout(
      reload,
      APPLY_UPDATE_TIMEOUT_MS,
    );
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

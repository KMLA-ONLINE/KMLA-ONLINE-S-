import { useCallback, useEffect, useRef, useState } from "react";

import {
  getInstallPreference,
  getFallbackInstallMode,
  INSTALL_PREFERENCE_KEY,
  isHandheld,
  isStandalone,
  neverShowInstallPrompt,
  recordInstallAvailable,
  recordInstallDismissal,
  recordInstalled,
  type InstallMode,
} from "~/shared/lib/install-platform";

/**
 * 첫 화면을 잠깐 써 본 뒤에 권하기 위한 지연. 도착하자마자 설치를 조르면 아직 쓸모를
 * 못 본 사용자에게 모달부터 들이미는 셈이다.
 *
 * 덤으로 `beforeinstallprompt`가 도착할 시간을 벌어 준다. 이벤트보다 먼저 수동 안내를
 * 띄우면 한 번 누르면 끝나는 설치 버튼 대신 "메뉴에서 직접 찾으세요"를 보여주게 된다.
 */
const REVEAL_DELAY_MS = 5000;

/** 아직 표준이 아니라 lib.dom에 타입이 없다. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface InstallPromptState {
  /** 다이얼로그를 열어야 하는지. */
  open: boolean;
  mode: InstallMode | null;
  confirmingNeverShow: boolean;
  /** `mode === "install"`일 때만 동작한다. 반드시 사용자 제스처 안에서 불러야 한다. */
  install: () => Promise<void>;
  dismiss: () => void;
  dismissForSession: () => void;
  neverShow: () => void;
  markInstalled: () => void;
}

/**
 * 홈 화면 추가 유도의 상태를 계산한다.
 *
 * `나중에`는 현재 문서에서 숨기며, 네 번째 거절에는 영구 숨김 여부를 한 번 더 묻는다.
 */
export function useInstallPrompt(
  delayMs = REVEAL_DELAY_MS,
): InstallPromptState {
  const [mode, setMode] = useState<InstallMode | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [confirmingNeverShow, setConfirmingNeverShow] = useState(false);
  const [scheduleVersion, setScheduleVersion] = useState(0);
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);
  const dismissedForSessionRef = useRef(false);

  useEffect(() => {
    if (!isHandheld()) return;

    if (isStandalone()) {
      // 설치된 창으로 들어왔다는 건 설치가 끝났다는 뜻이다. `appinstalled`를 놓친
      // 경우(다른 기기·다른 탭에서 설치)도 여기서 회수된다.
      recordInstalled();
      return;
    }

    const preference = getInstallPreference();
    let timer: number | null = null;

    const scheduleReveal = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const current = getInstallPreference();
        if (
          dismissedForSessionRef.current ||
          current.installed ||
          current.neverShow
        ) {
          return;
        }

        setMode((currentMode) => currentMode ?? getFallbackInstallMode());
        setRevealed(true);
      }, delayMs);
    };

    const onBeforeInstallPrompt = (event: Event) => {
      // 기본 mini-infobar를 막고, 설치 시점을 우리 다이얼로그의 버튼으로 옮긴다.
      event.preventDefault();
      const current = getInstallPreference();
      if (current.neverShow) return;

      recordInstallAvailable();
      deferredRef.current = event as BeforeInstallPromptEvent;
      setMode("install");
      if (current.installed) scheduleReveal();
    };

    const onInstalled = () => {
      recordInstalled();
      deferredRef.current = null;
      setRevealed(false);
      setScheduleVersion((current) => current + 1);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== INSTALL_PREFERENCE_KEY) return;

      const current = getInstallPreference();
      if (current.installed || current.neverShow) {
        deferredRef.current = null;
        setConfirmingNeverShow(false);
        setRevealed(false);
      }
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("storage", onStorage);

    if (!preference.installed && !preference.neverShow) scheduleReveal();

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("storage", onStorage);
    };
  }, [delayMs, scheduleVersion]);

  const dismissForSession = useCallback(() => {
    dismissedForSessionRef.current = true;
    setConfirmingNeverShow(false);
    setRevealed(false);
  }, []);

  const dismiss = useCallback(() => {
    const preference = recordInstallDismissal();
    if (preference.dismissCount >= 4) {
      setConfirmingNeverShow(true);
      return;
    }

    dismissForSession();
  }, [dismissForSession]);

  const neverShow = useCallback(() => {
    neverShowInstallPrompt();
    setConfirmingNeverShow(false);
    setRevealed(false);
    setScheduleVersion((current) => current + 1);
  }, []);

  const markInstalled = useCallback(() => {
    recordInstalled();
    deferredRef.current = null;
    setConfirmingNeverShow(false);
    setRevealed(false);
    setScheduleVersion((current) => current + 1);
  }, []);

  const install = useCallback(async () => {
    const deferred = deferredRef.current;
    if (!deferred) return;

    // 이 이벤트는 한 번만 쓸 수 있다. 거절당하면 이번 로드에서 다시 띄울 방법이 없다.
    deferredRef.current = null;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;

      if (choice.outcome === "accepted") {
        recordInstalled();
      } else {
        // Browser-level rejection does not count toward the four custom
        // "later" choices.
        setMode(getFallbackInstallMode());
      }
    } catch {
      setMode(getFallbackInstallMode());
    } finally {
      setRevealed(false);
    }
  }, []);

  return {
    open: revealed && mode !== null,
    mode,
    confirmingNeverShow,
    install,
    dismiss,
    dismissForSession,
    neverShow,
    markInstalled,
  };
}

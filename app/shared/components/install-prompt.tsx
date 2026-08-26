import {
  CheckIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  ExternalLinkIcon,
  ShareIcon,
  SquarePlusIcon,
} from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";

import { useInstallPrompt } from "~/shared/hooks/use-install-prompt";
import type { InstallMode } from "~/shared/lib/install-platform";
import { setPromptActive } from "~/shared/lib/prompt-coordinator";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";

/**
 * 다이얼로그가 뜬 직후 버튼을 잠가 두는 시간.
 *
 * 이 안내는 사용자가 화면을 쓰던 도중에 스스로 뜬다(`useInstallPrompt`의 5초 지연). 마침
 * 누르고 있던 손가락이 그대로 내려앉아 `나중에`를 눌러 버리면 읽을 새도 없이 사라진다.
 * 배경 터치는 `disablePointerDismissal`이 막고, 버튼은 이만큼 늦게 열어 준다.
 */
const INTERACTION_LOCK_MS = 2000;

interface InstallStep {
  icon?: ComponentType<{ className?: string }>;
  text: string;
}

interface InstallCopy {
  title: string;
  description: string;
  steps: InstallStep[];
  /**
   * 이 브라우저에서 설치를 끝낼 수 있는가.
   *
   * 인앱 브라우저처럼 설치 자체가 막힌 곳에서는 「설치완료」를 보여 줄 이유가 없다 —
   * 할 수 없다고 안내해 놓고 완료를 묻는 꼴이고, 눌러도 정작 설치할 브라우저가 아닌
   * 이곳의 기록만 바뀐다. 모드를 추가할 때 이 값을 반드시 정하게 하려고 필수로 둔다.
   */
  installable: boolean;
}

const ANDROID_STEPS: InstallStep[] = [
  { icon: EllipsisVerticalIcon, text: "브라우저 메뉴를 여세요." },
  { icon: DownloadIcon, text: "'설치'를 선택하세요." },
];

const IOS_STEPS: InstallStep[] = [
  { icon: ShareIcon, text: "브라우저의 공유 버튼을 누르세요." },
  { icon: SquarePlusIcon, text: "'홈 화면에 추가'를 선택하세요." },
  { text: "오른쪽 위 '추가'를 누르면 끝이에요." },
];

const COPY: Record<InstallMode, InstallCopy> = {
  install: {
    title: "홈 화면에 KMLA Online 추가",
    description: "*추천* 설치해 두면 주소창 없이 앱처럼 열려요.",
    steps: [],
    installable: true,
  },
  "ios-browser": {
    title: "홈 화면에 추가해 주세요",
    description: "*추천* 앱처럼 사용 가능해요",
    steps: IOS_STEPS,
    installable: true,
  },
  "ios-other": {
    title: "Safari에서 열어 주세요",
    description:
      "이 브라우저에서는 홈 화면에 추가할 수 없어요. 주소를 복사해 Safari로 연 뒤 아래 순서대로 진행하세요.",
    steps: IOS_STEPS,
    installable: false,
  },
  "android-help": {
    title: "홈 화면에 추가해 주세요",
    description:
      "*추천* 브라우저 메뉴에서 직접 설치할 수 있어요. Chrome/구글에서 가장 안정적으로 동작해요.",
    steps: ANDROID_STEPS,
    installable: true,
  },
  "android-other": {
    title: "Chrome에서 열어 주세요",
    description:
      "앱 안에서 열린 웹에서는 설치가 불가능해요. Chrome/구글로 옮긴 뒤 아래 순서대로 진행하세요.",
    steps: [
      {
        icon: ExternalLinkIcon,
        text: "오른쪽 위 메뉴에서 '외부 브라우저에서 열기'를 선택하세요.",
      },
      ...ANDROID_STEPS,
    ],
    installable: false,
  },
};

/**
 * 홈 화면 추가 유도 다이얼로그.
 *
 * 폰·태블릿에서만, 그리고 아직 설치하지 않은 사용자에게만 뜬다. 판단은 전부
 * `useInstallPrompt`가 하고 여기서는 문구만 고른다.
 *
 * 루트에서 렌더해 로그인 여부와 관계없이 설치할 수 있게 한다. 서비스 워커 상태 안내가
 * 보이는 동안에는 `blocked`로 잠시 미룬다.
 */
export function InstallPrompt({
  blocked = false,
  interactionLockMs = INTERACTION_LOCK_MS,
}: {
  blocked?: boolean;
  /** 뜬 직후 버튼을 잠가 두는 시간. 테스트에서 줄이려고 열어 둔다. */
  interactionLockMs?: number;
}) {
  const {
    open,
    mode,
    confirmingNeverShow,
    install,
    dismiss,
    dismissForSession,
    neverShow,
    markInstalled,
  } = useInstallPrompt();

  const visible = open && !blocked;
  const [wasVisible, setWasVisible] = useState(visible);
  const [locked, setLocked] = useState(visible);

  // 뜨는 순간에 잠근다. effect 안에서 setState 하지 않으려고 렌더 중에 맞춘다.
  if (wasVisible !== visible) {
    setWasVisible(visible);
    setLocked(visible);
  }

  useEffect(() => {
    if (!locked) return;

    const timer = window.setTimeout(() => setLocked(false), interactionLockMs);
    return () => window.clearTimeout(timer);
  }, [interactionLockMs, locked]);

  if (!mode) return null;

  const copy = COPY[mode];
  const canInstall = mode === "install";

  return (
    <Dialog
      open={visible}
      // 배경 터치로는 닫히지 않는다. 나가려면 버튼을 눌러야 하므로 안내를 한 번은 보게 된다.
      disablePointerDismissal
      onOpenChange={(next) => {
        if (!next) {
          if (confirmingNeverShow) dismissForSession();
          else dismiss();
        }
      }}
    >
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        {confirmingNeverShow ? (
          <>
            <DialogHeader>
              <DialogTitle>설치 안내를 그만 볼까요?</DialogTitle>
              <DialogDescription>
                다시 보지 않기를 선택하면 이 브라우저에서는 설치 안내를 더 이상
                표시하지 않아요.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" size="lg" onClick={neverShow}>
                다시 보지 않기
              </Button>
              <Button size="lg" onClick={dismissForSession}>
                나중에
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>{copy.description}</DialogDescription>
            </DialogHeader>

            {copy.steps.length > 0 && (
              <ol className="flex flex-col gap-3 text-sm">
                {copy.steps.map((step, index) => (
                  <li key={step.text} className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums"
                    >
                      {index + 1}
                    </span>
                    {step.icon && <step.icon className="size-4 shrink-0" />}
                    <span>{step.text}</span>
                  </li>
                ))}
              </ol>
            )}

            <DialogFooter>
              <Button
                variant={copy.installable ? "ghost" : "default"}
                size="lg"
                disabled={locked}
                onClick={dismiss}
              >
                {copy.installable ? "나중에" : "알겠어요"}
              </Button>
              {canInstall ? (
                <Button
                  size="lg"
                  disabled={locked}
                  onClick={() => void install()}
                >
                  <DownloadIcon />
                  설치하기
                </Button>
              ) : copy.installable ? (
                <Button size="lg" disabled={locked} onClick={markInstalled}>
                  <CheckIcon />
                  설치완료
                </Button>
              ) : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

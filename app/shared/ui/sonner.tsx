"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // 모바일에서 토스트는 화면 아래에 붙는데, 그 자리는 하단 탭바가 이미 쓰고 있다.
      // 기본 오프셋이면 "저장했습니다" 같은 짧은 토스트가 탭바에 가려 안 보인다. 탭바
      // 높이와 홈 인디케이터만큼 띄운다 — 탭바는 스크롤에 따라 숨지만, 숨은 자리에
      // 맞춰 토스트가 움직이면 그게 더 산만하므로 항상 보이는 위치를 기준으로 둔다.
      mobileOffset={{
        bottom: "calc(var(--app-tabbar-h) + var(--app-safe-b) + 0.75rem)",
        left: "1rem",
        right: "1rem",
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

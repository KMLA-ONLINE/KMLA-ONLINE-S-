import { GraduationCapIcon, LogInIcon, SchoolIcon } from "lucide-react";
import type { ComponentType } from "react";

interface SchoolLink {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

export const schoolLinks: SchoolLink[] = [
  {
    href: "https://www.minjok.hs.kr/",
    label: "홈페이지",
    icon: SchoolIcon,
  },
  {
    href: "https://old.minjok.hs.kr/members/login.php",
    label: "인트라넷",
    icon: LogInIcon,
  },
  {
    href: "https://minjok.riroschool.kr/",
    label: "리로스쿨",
    icon: GraduationCapIcon,
  },
];

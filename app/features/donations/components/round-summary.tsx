import type { RoundPhase } from "~/features/donations/model/round-time";
import { useT, type Locale } from "~/shared/i18n";
import { Badge } from "~/shared/ui/badge";

const formatters: Record<Locale, Intl.DateTimeFormat> = {
  ko: new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }),
  en: new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }),
};

export function formatDonationDate(value: string, locale: Locale = "ko") {
  return formatters[locale].format(new Date(value));
}

const PHASES: Record<
  RoundPhase,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  open: { label: "신청 진행 중", variant: "default" },
  upcoming: { label: "신청 예정", variant: "secondary" },
  ended: { label: "신청 종료", variant: "outline" },
};

export function RoundPhaseBadge({ phase }: { phase: RoundPhase }) {
  const t = useT();
  const { label, variant } = PHASES[phase];
  return <Badge variant={variant}>{t(label)}</Badge>;
}

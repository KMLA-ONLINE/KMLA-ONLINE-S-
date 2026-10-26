import {
  LanguagesIcon,
  LayoutGridIcon,
  ListIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react";
import { useTheme } from "next-themes";

import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { usePostViewMode } from "~/features/posts";
import { useExperimentalFeatures } from "~/shared/hooks/use-experimental-features";
import { useLanguagePreference, useT } from "~/shared/i18n";
import { cn } from "~/shared/lib/utils";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

const postViewOptions = [
  { value: "card" as const, label: "카드", icon: LayoutGridIcon },
  { value: "list" as const, label: "목록", icon: ListIcon },
];

const themeOptions = [
  { value: "system", label: "시스템", icon: MonitorIcon },
  { value: "light", label: "라이트", icon: SunIcon },
  { value: "dark", label: "다크", icon: MoonIcon },
] as const;

// 언어 이름은 그 언어로 적는다. 영어 화면에서 길을 잃은 사람도 "한국어"는 읽을 수 있어야 한다.
const languageOptions = [
  { value: "system", label: "시스템", icon: MonitorIcon, translate: true },
  { value: "ko", label: "한국어", icon: LanguagesIcon, translate: false },
  { value: "en", label: "English", icon: LanguagesIcon, translate: false },
] as const;

const optionButtonClass =
  "flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border bg-card text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export default function SettingsLabPage() {
  const t = useT();
  const [experimentalFeaturesEnabled] = useExperimentalFeatures();
  const [viewMode, setViewMode] = usePostViewMode();
  const { theme, setTheme } = useTheme();
  const [language, setLanguage] = useLanguagePreference();

  if (!experimentalFeaturesEnabled) {
    return (
      <>
        <PageHeader title={t("실험실")} back="/settings" />

        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-0">
          <h1 className="hidden text-2xl font-semibold md:block">
            {t("실험실")}
          </h1>
          <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
            {t("실험실 기능을 켜면 설정을 사용할 수 있습니다.")}
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("실험실")} back="/settings" />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-0">
        <div>
          <h1 className="hidden text-2xl font-semibold md:block">
            {t("실험실")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("개발 중인 설정입니다. 기능이 변경되거나 제거될 수 있습니다.")}
          </p>
        </div>

        <section className="flex flex-col gap-2">
          <div className="px-1">
            <h2 className="text-sm font-semibold">{t("게시물 보기")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("홈 피드와 그룹 게시물에 함께 적용됩니다.")}
            </p>
          </div>

          <div
            className="grid grid-cols-2 gap-2"
            role="group"
            aria-label={t("게시물 보기 방식")}
          >
            {postViewOptions.map((option) => {
              const Icon = option.icon;
              const selected = viewMode === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setViewMode(option.value)}
                  className={cn(
                    optionButtonClass,
                    selected
                      ? "border-primary text-primary"
                      : "hover:bg-muted/60",
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  {t(option.label)}
                </button>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <div className="px-1">
            <h2 className="text-sm font-semibold">{t("테마")}</h2>
          </div>

          <div
            className="grid grid-cols-3 gap-2"
            role="group"
            aria-label={t("테마")}
          >
            {themeOptions.map((option) => {
              const Icon = option.icon;
              const selected = theme === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setTheme(option.value)}
                  className={cn(
                    optionButtonClass,
                    selected
                      ? "border-primary text-primary"
                      : "hover:bg-muted/60",
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  {t(option.label)}
                </button>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <div className="px-1">
            <h2 className="text-sm font-semibold">{t("언어")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                "앱 문구에만 적용됩니다. 게시물과 메시지 내용은 바뀌지 않습니다.",
              )}
            </p>
          </div>

          <div
            className="grid grid-cols-3 gap-2"
            role="group"
            aria-label={t("언어")}
          >
            {languageOptions.map((option) => {
              const Icon = option.icon;
              const selected = language === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  lang={option.value === "system" ? undefined : option.value}
                  onClick={() => setLanguage(option.value)}
                  className={cn(
                    optionButtonClass,
                    selected
                      ? "border-primary text-primary"
                      : "hover:bg-muted/60",
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  {option.translate ? t(option.label) : option.label}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

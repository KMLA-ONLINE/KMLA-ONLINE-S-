import {
  BellIcon,
  ChevronRightIcon,
  CircleQuestionMarkIcon,
  FileTextIcon,
  FlaskConicalIcon,
  KeyRoundIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react";
import { Link } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { LogoutButton } from "~/features/auth";
import { AppVersionCard } from "~/features/support";
import { ListLinkRow } from "~/shared/components/list-link-row";
import { useExperimentalFeatures } from "~/shared/hooks/use-experimental-features";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldTitle,
} from "~/shared/ui/field";
import { Switch } from "~/shared/ui/switch";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

export default function SettingsPage() {
  const { profile } = useAppShell();
  const [experimentalFeaturesEnabled, setExperimentalFeaturesEnabled] =
    useExperimentalFeatures();

  return (
    <>
      <PageHeader title="설정" back="/menu" />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-0">
        <h1 className="hidden text-2xl font-semibold md:block">설정</h1>

        <section className="flex flex-col gap-1.5">
          <h2 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground">
            계정
          </h2>

          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            <ListLinkRow
              to="/menu/password"
              label="비밀번호 변경"
              icon={KeyRoundIcon}
            />
            <LogoutButton appearance="row" />
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground">
            앱 설정
          </h2>
          <div className="overflow-hidden rounded-xl border bg-card">
            <ListLinkRow
              to="/noti/settings"
              label="알림 설정"
              icon={BellIcon}
            />
          </div>
          <div className="px-1">
            <h3 className="text-sm font-semibold">실험실</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              완성 전 기능을 먼저 사용해 볼 수 있습니다.
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border bg-card">
            <Field orientation="horizontal" className="px-4 py-3">
              <FieldContent>
                <FieldTitle>실험실 기능 사용</FieldTitle>
                <FieldDescription>
                  기능이 변경되거나 제거될 수 있습니다.
                </FieldDescription>
              </FieldContent>
              <Switch
                aria-label="실험실 기능 사용"
                checked={experimentalFeaturesEnabled}
                onCheckedChange={setExperimentalFeaturesEnabled}
              />
            </Field>

            {experimentalFeaturesEnabled ? (
              <Link
                to="/menu/settings/lab"
                className="flex items-center gap-3 border-t px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/60"
              >
                <FlaskConicalIcon
                  className="size-4.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">실험실 설정</span>
                <ChevronRightIcon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </Link>
            ) : null}
          </div>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground">
            서비스 안내
          </h2>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            <ListLinkRow
              to="/support"
              label="도움말"
              icon={CircleQuestionMarkIcon}
            />
            <ListLinkRow
              to="/update"
              label="업데이트 기록"
              icon={SparklesIcon}
            />
            <ListLinkRow
              to="/menu/licenses"
              label="오픈소스 라이선스"
              icon={FileTextIcon}
            />
          </div>
        </section>

        {profile.role === "admin" ? (
          <section className="flex flex-col gap-1.5">
            <h2 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground">
              관리
            </h2>
            <div className="overflow-hidden rounded-xl border bg-card">
              <ListLinkRow
                to="/admin"
                label="관리자 페이지"
                icon={ShieldCheckIcon}
              />
            </div>
          </section>
        ) : null}

        <AppVersionCard />
      </div>
    </>
  );
}
